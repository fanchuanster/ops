import type { Book } from '../../payload-types'

import config from '@payload-config'
import { getPayload } from 'payload'

import { applySuggestions } from '../../domain/applySuggestions'
import { artifactKey, suggestionsKey } from '../../domain/bookStorage'
import {
  type CorrectionJobKind,
  type CorrectionState,
  correctionClaimableAs,
  correctionCompletedState,
  correctionInProgressState,
  correctionStateForMaster,
  readCorrectionState,
  readDecisions,
} from '../../domain/correction'
import { type Document } from '../../domain/document'
import {
  type ConversionState,
  type JobKind,
  completedState,
  inProgressState,
} from '../../domain/pipeline'
import { originalArtifact, readSourceKind } from '../../domain/publication'
import { suggestCorrections } from '../../domain/proofread'
import { readText } from '../../domain/textSource'
import { artifactBytes, putObject } from '../storage'
import { logError } from '../logError'
import { readDocx } from './docxRead'
import { buildDocx } from './docxWrite'
import { buildEpub } from './epubWrite'
import { createChatClient, llmConfigFromEnv } from './llm'

type Payload = Awaited<ReturnType<typeof getPayload>>

const CLAIMABLE = ['master_ready', 'ocr_ready'] as const

const CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  json: 'application/json',
}

function keyFor(wanted: string, current?: string | null): string {
  return typeof current === 'string' && current.length > 0 ? current : wanted
}

function currentKey(book: Book, format: 'docx' | 'epub'): string | null {
  return (book.artifacts ?? []).find((artifact) => artifact.format === format)?.storageKey ?? null
}

export interface TickResult {
  claimed: 'conversion' | 'correction' | null
  bookId?: number
  kind?: JobKind | CorrectionJobKind
  outcome?: 'completed' | 'failed'
  message?: string
}

async function claim(
  payload: Payload,
  book: Book,
  from: ConversionState,
  to: ConversionState,
): Promise<boolean> {
  const claimed = await payload.update({
    collection: 'books',
    where: { and: [{ id: { equals: book.id } }, { 'conversion.state': { equals: from } }] },
    data: { conversion: { ...book.conversion, state: to } },
    overrideAccess: true,
  })
  return claimed.docs.length > 0
}

async function claimCorrection(
  payload: Payload,
  book: Book,
  from: CorrectionState,
  to: CorrectionState,
): Promise<boolean> {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  const claimed = await payload.update({
    collection: 'books',
    where: {
      and: [{ id: { equals: book.id } }, { 'conversion.correction.state': { equals: from } }],
    },
    data: { conversion: { ...conversion, correction: { ...correction, state: to } } },
    overrideAccess: true,
  })
  return claimed.docs.length > 0
}

function masterKeyOf(book: Book): string | null {
  return (book.artifacts ?? []).find((a) => a.format === 'docx')?.storageKey ?? null
}

async function fetchDocument(key: string, title: string, author: string | null): Promise<Document> {
  const bytes = await artifactBytes(key)
  if (!bytes) throw new Error(`the master at ${key} is not in storage`)
  const document = readDocx(bytes, title)
  document.title = title
  document.author = author ?? document.author
  return document
}

async function runMaster(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const sourceKey = book.conversion?.sourceKey
  if (!sourceKey) throw new Error('this book has no uploaded source to read')

  const bytes = await artifactBytes(sourceKey)
  if (!bytes) throw new Error(`the source at ${sourceKey} is not in storage`)

  const kind = readSourceKind(book.conversion ?? {})
  let document: Document
  if (kind === 'docx') {
    document = readDocx(bytes, book.title)
  } else if (kind === 'text') {
    document = readText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), book.title)
  } else {
    throw new Error(`a ${kind} source does not need a master built`)
  }
  document.author = book.author ?? document.author

  const key = keyFor(artifactKey(book.id, 'docx'), currentKey(book, 'docx'))
  if (!(await putObject(key, buildDocx(document, book.author), CONTENT_TYPES.docx))) {
    throw new Error('object storage is not configured')
  }

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts: [...existing.filter((a) => a.format !== 'docx'), { format: 'docx', storageKey: key }],
      conversion: {
        ...book.conversion,
        state: completedState('master'),
        message: null,
        correction: {
          ...((book.conversion?.correction ?? {}) as object),
          state: correctionStateForMaster(book.conversion?.aiCorrection),
        },
      },
    },
    overrideAccess: true,
  })

  return { claimed: 'conversion', bookId, kind: 'master', outcome: 'completed' }
}

async function runFormats(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to build from')

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)

  const key = keyFor(artifactKey(book.id, 'epub'), currentKey(book, 'epub'))
  const epub = buildEpub(document, { identifier: `noblesee-${bookId}` })
  if (!(await putObject(key, epub, CONTENT_TYPES.epub))) {
    throw new Error('object storage is not configured')
  }

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts: [...existing.filter((a) => a.format !== 'epub'), { format: 'epub', storageKey: key }],
      conversion: { ...book.conversion, state: completedState('formats'), message: null },
      status: 'published' as const,
    },
    overrideAccess: true,
  })

  return { claimed: 'conversion', bookId, kind: 'formats', outcome: 'completed' }
}

async function runCorrect(payload: Payload, book: Book, env: Record<string, unknown>) {
  const bookId = Number(book.id)
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>

  if (book.conversion?.aiCorrection !== true) {
    throw new Error('this book has not been offered for third-party AI correction')
  }

  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to read')

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)
  const client = createChatClient(llmConfigFromEnv(env))
  const report = await suggestCorrections(document, client.complete, { model: client.model })

  const key = keyFor(
    suggestionsKey(book.id),
    book.conversion?.correction?.suggestionsKey,
  )
  const body = JSON.stringify({
    model: report.model,
    batches: report.batches,
    lines_examined: report.linesExamined,
    suggestions: report.suggestions,
    rejected: report.rejected,
  })
  if (!(await putObject(key, new TextEncoder().encode(body), CONTENT_TYPES.json))) {
    throw new Error('object storage is not configured')
  }

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        correction: {
          ...correction,
          state: correctionCompletedState('correct'),
          suggestionsKey: key,
          count: report.suggestions.length,
          decisionsKey: null,
          adopted: null,
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  return {
    claimed: 'correction' as const,
    bookId,
    kind: 'correct' as const,
    outcome: 'completed' as const,
  }
}

async function runApply(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>

  const decisionsKey = correction.decisionsKey
  if (typeof decisionsKey !== 'string') throw new Error('there are no decisions to apply')

  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to correct')

  const raw = await artifactBytes(decisionsKey)
  if (!raw) throw new Error(`the decisions at ${decisionsKey} are not in storage`)
  const decisions = readDecisions(JSON.parse(new TextDecoder().decode(raw)))

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)
  const report = applySuggestions(document, decisions)

  const wrote = report.applied.length > 0
  if (wrote) {
    const key = keyFor(artifactKey(book.id, 'docx'), currentKey(book, 'docx'))
    if (!(await putObject(key, buildDocx(document, book.author), CONTENT_TYPES.docx))) {
      throw new Error('object storage is not configured')
    }
  }

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        ...(wrote ? { state: 'master_ready' as const } : {}),
        correction: {
          ...correction,
          state: correctionCompletedState('apply'),
          adopted: report.applied.length,
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  return { claimed: 'correction', bookId, kind: 'apply', outcome: 'completed' }
}

async function failConversion(payload: Payload, book: Book, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'The conversion did not complete.'
  await payload.update({
    collection: 'books',
    id: Number(book.id),
    data: { conversion: { ...book.conversion, state: 'failed', message } },
    overrideAccess: true,
  })
  return message
}

async function failCorrection(payload: Payload, book: Book, error: unknown) {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  const message = error instanceof Error ? error.message.slice(0, 500) : 'The correction did not complete.'
  await payload.update({
    collection: 'books',
    id: Number(book.id),
    data: {
      conversion: { ...conversion, correction: { ...correction, state: 'failed', message } },
    },
    overrideAccess: true,
  })
  return message
}

export async function runOneJob(env: Record<string, unknown>): Promise<TickResult> {
  const payload = await getPayload({ config })

  for (const state of CLAIMABLE) {
    const waiting = await payload.find({
      collection: 'books',
      where: { 'conversion.state': { equals: state } },
      sort: 'createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })

    for (const book of waiting.docs) {
      const kind: JobKind = state === 'master_ready' ? 'formats' : 'master'
      if (!(await claim(payload, book, state, inProgressState(kind)))) continue

      try {
        return kind === 'master' ? await runMaster(payload, book) : await runFormats(payload, book)
      } catch (error) {
        logError(`conversion: ${kind} job for book ${book.id}`, error)
        const message = await failConversion(payload, book, error)
        return { claimed: 'conversion', bookId: Number(book.id), kind, outcome: 'failed', message }
      }
    }
  }

  for (const state of ['decided', 'pending'] as const) {
    const waiting = await payload.find({
      collection: 'books',
      where: { 'conversion.correction.state': { equals: state } },
      sort: 'createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })

    for (const book of waiting.docs) {
      const correction = (book.conversion?.correction ?? {}) as Record<string, unknown>
      const kind = correctionClaimableAs(readCorrectionState(correction.state))
      if (!kind) continue
      if (!masterKeyOf(book)) continue
      if (!(await claimCorrection(payload, book, state, correctionInProgressState(kind)))) continue

      try {
        return kind === 'correct'
          ? await runCorrect(payload, book, env)
          : await runApply(payload, book)
      } catch (error) {
        logError(`correction: ${kind} job for book ${book.id}`, error)
        const message = await failCorrection(payload, book, error)
        return { claimed: 'correction', bookId: Number(book.id), kind, outcome: 'failed', message }
      }
    }
  }

  return { claimed: null }
}
