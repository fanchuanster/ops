import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Payload } from 'payload'

import {
  MAX_EXPORT_RETRIES,
  exportHasExpired,
  exportLocaleFor,
  isTransientExportFailure,
  masterKey,
  withinSizeLimit,
} from '../domain/adobe'
import type { ArtifactFormat } from '../domain/conversion'
import { bookStem } from '../domain/bookStorage'
import { type CorrectionState, correctionStateForMaster } from '../domain/correction'
import {
  type ConversionState,
  needsMasterRun,
  releasedExportHandle,
  stateWithoutExport,
  statusOnQueue,
} from '../domain/pipeline'
import {
  type SourceKind,
  needsExport,
  originalArtifact,
  originalKey,
  readSourceKind,
  resolvePlan,
} from '../domain/publication'
import {
  ADD_SOURCE_ERRORS,
  type BookSource,
  canAddSource,
  readSources,
} from '../domain/sources'
import type { Book } from '../payload-types'
import {
  type AdobeCredentials,
  accessToken,
  createAsset,
  deleteAsset,
  downloadResult,
  exportStatus,
  startExport,
  uploadAsset,
} from './adobe/client'
import { freeStem } from './bookObjects'
import { artifactBytes, copyObject, objectBucket } from './storage'
import { logError } from './logError'

export async function adobeConfig(): Promise<AdobeCredentials | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const e = env as unknown as Record<string, string | undefined>

    const clientId = e.ADOBE_CLIENT_ID || e.ADOBE_API_KEY
    const clientSecret = e.ADOBE_CLIENT_SECRET

    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  } catch {
    return null
  }
}

async function sourceHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function alreadyExported(
  payload: Payload,
  hash: string,
  bookId: string | number,
): Promise<{ storageKey: string; pageCount: number | null } | null> {
  const twin = await payload.find({
    collection: 'books',
    where: {
      and: [{ 'conversion.sourceHash': { equals: hash } }, { id: { not_equals: bookId } }],
    },
    sort: 'createdAt',
    limit: 4,
    depth: 0,
    overrideAccess: true,
  })

  for (const found of twin.docs) {
    const master = (found.artifacts ?? []).find((artifact) => artifact.format === 'docx')
    if (!master?.storageKey) continue
    return {
      storageKey: master.storageKey,
      pageCount: typeof found.pageCount === 'number' ? found.pageCount : null,
    }
  }
  return null
}

async function fail(
  payload: Payload,
  book: { id: string | number; conversion?: unknown },
  message: string,
) {
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      conversion: {
        ...(book.conversion as Record<string, unknown>),
        state: 'failed',
        message: message.slice(0, 500),
      },
    },
    overrideAccess: true,
  })
}

async function failOrRetry(
  payload: Payload,
  book: { id: string | number },
  conversion: Record<string, unknown>,
  { message, retryable }: { message: string; retryable: boolean },
): Promise<boolean> {
  const retries = typeof conversion.exportRetries === 'number' ? conversion.exportRetries : 0
  logError(`export: book ${book.id} failed after ${retries} retries`, message)

  if (!retryable || retries >= MAX_EXPORT_RETRIES) {
    await fail(
      payload,
      { id: book.id, conversion },
      retryable
        ? 'The service that reads scanned pages was busy every time we tried, so this book has not been read yet. Nothing is wrong with your file — try again in a little while.'
        : message,
    )
    return false
  }

  const attempt = retries + 1
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      conversion: {
        ...conversion,
        state: 'queued' as const,
        ...releasedExportHandle('queued'),
        exportRetries: attempt,
        message: `The service that reads scanned pages was busy, so this book is being sent again (attempt ${attempt + 1} of ${MAX_EXPORT_RETRIES + 1}). Nothing is wrong with your file and there is nothing to do.`,
      },
    },
    overrideAccess: true,
  })
  return true
}

function correctionFor(
  conversion: Record<string, unknown>,
  state: ConversionState,
): { correction?: { state: CorrectionState } } {
  if (state !== 'master_ready') return {}
  return {
    correction: {
      ...((conversion.correction as object) ?? {}),
      state: correctionStateForMaster(conversion.aiCorrection),
    },
  }
}

async function attachMaster(
  payload: Payload,
  book: { id: string | number; conversion?: unknown; artifacts?: Book['artifacts'] },
  {
    bytes,
    conversion,
    pageCount,
  }: { bytes: Uint8Array; conversion: Record<string, unknown>; pageCount?: number | null },
): Promise<boolean> {
  const bucket = await objectBucket()
  if (!bucket) {
    await fail(payload, book, 'Object storage is not available.')
    return true
  }

  const key = masterKey(book.id)
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  })

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      artifacts: [
        ...existing.filter((artifact) => artifact.format !== 'docx'),
        {
          format: 'docx' as const,
          storageKey: key,
          bytes: bytes.byteLength,
          downloadable: false,
        },
      ],
      conversion: {
        ...conversion,
        state: 'master_ready',
        exportJob: null,
        exportAsset: null,
        exportRetries: 0,
        message: null,
        correction: {
          ...((conversion as { correction?: object }).correction ?? {}),
          state: correctionStateForMaster(
            (conversion as { aiCorrection?: unknown }).aiCorrection,
          ),
        },
      },
      ...(pageCount ? { pageCount } : {}),
    },
    overrideAccess: true,
  })
  return true
}

async function fileUnderBook(
  book: { artifacts?: Book['artifacts'] },
  {
    kind,
    format,
    sourceKey,
    filename,
    anchorFilename,
  }: {
    kind: SourceKind
    format: ArtifactFormat
    sourceKey: string
    filename: unknown
    anchorFilename: unknown
  },
): Promise<{ artifacts: NonNullable<Book['artifacts']>; source: BookSource } | null> {
  const existing = book.artifacts ?? []

  const filed = existing.some(
    (artifact) => typeof artifact.storageKey === 'string' && artifact.storageKey.length > 0,
  )
  const wanted = bookStem({ artifacts: existing, sourceFilename: anchorFilename })
  const stem = filed ? wanted : await freeStem({ wanted, owned: [] })

  const key = originalKey(stem, kind)
  const size = await copyObject(sourceKey, key, CONTENT_TYPES[kind])
  if (size === null) return null

  return {
    artifacts: [
      ...existing,
      {
        format,
        storageKey: key,
        bytes: size,
        downloadable: format !== 'docx',
      },
    ],
    source: {
      kind,
      storageKey: key,
      filename: typeof filename === 'string' ? filename : '',
      bytes: size,
      addedAt: new Date().toISOString(),
    },
  }
}

function statusFor(artifacts: NonNullable<Book['artifacts']>): { status?: 'published' } {
  return statusOnQueue(artifacts.map((artifact) => artifact.format)) === 'published'
    ? { status: 'published' }
    : {}
}

async function fileOriginal(
  payload: Payload,
  book: { id: string | number; conversion?: unknown; artifacts?: Book['artifacts'] },
  { conversion, kind }: { conversion: Record<string, unknown>; kind: SourceKind },
): Promise<{
  artifacts: NonNullable<Book['artifacts']>
  conversion: Record<string, unknown>
} | null> {
  const format = originalArtifact(kind)
  const existing = book.artifacts ?? []
  if (!format) return { artifacts: existing, conversion }
  if (existing.some((artifact) => artifact.format === format)) {
    return { artifacts: existing, conversion }
  }

  const filed = await fileUnderBook(book, {
    kind,
    format,
    sourceKey: conversion.sourceKey as string,
    filename: conversion.sourceFilename,
    anchorFilename: conversion.sourceFilename,
  })
  if (!filed) {
    await fail(payload, book, 'The uploaded file could not be read from storage.')
    return null
  }

  const sources = [
    ...readSources(conversion, existing).filter((source) => source.kind !== kind),
    filed.source,
  ]

  const next = {
    ...conversion,
    sources,
    sourceKey: filed.source.storageKey,
  }

  await payload.update({
    collection: 'books',
    id: book.id,
    data: { artifacts: filed.artifacts, conversion: next, ...statusFor(filed.artifacts) },
    overrideAccess: true,
  })
  return { artifacts: filed.artifacts, conversion: next }
}

export async function addSourceToBook(
  payload: Payload,
  book: Book,
  { kind, sourceKey, filename }: { kind: SourceKind; sourceKey: string; filename: string },
): Promise<string | null> {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const decision = canAddSource({
    kind,
    existingFormats: [
      ...(book.artifacts ?? []).map((artifact) => artifact.format),
      ...readSources(conversion, book.artifacts).map((source) => originalArtifact(source.kind)),
    ],
  })
  if (!decision.allowed) return ADD_SOURCE_ERRORS[decision.reason]

  const filed = await fileUnderBook(book, {
    kind,
    format: decision.slot,
    sourceKey,
    filename,
    anchorFilename: conversion.sourceFilename,
  })
  if (!filed) return 'That file could not be stored. Please try again.'

  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      artifacts: filed.artifacts,
      conversion: {
        ...conversion,
        sources: [
          ...readSources(conversion, book.artifacts).filter((source) => source.kind !== kind),
          filed.source,
        ],
      },
      ...statusFor(filed.artifacts),
    },
    overrideAccess: true,
  })
  return null
}

const CONTENT_TYPES: Record<SourceKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  text: 'text/plain; charset=utf-8',
}

async function noteWaiting(
  payload: Payload,
  book: { id: string | number },
  conversion: Record<string, unknown>,
  message: string,
): Promise<void> {
  if (conversion.message === message) return
  await payload.update({
    collection: 'books',
    id: book.id,
    data: { conversion: { ...conversion, message } },
    overrideAccess: true,
  })
}

const QUEUE_SCAN = 5

export async function startNextMaster(
  payload: Payload,
  credentials: AdobeCredentials | null,
): Promise<boolean> {
  const queued = await payload.find({
    collection: 'books',
    where: { 'conversion.state': { equals: 'queued' } },
    sort: 'createdAt',
    limit: QUEUE_SCAN,
    depth: 0,
    overrideAccess: true,
  })

  for (const book of queued.docs) {
    if (await startMasterFor(payload, book, credentials)) return true
  }
  return false
}

async function startMasterFor(
  payload: Payload,
  book: Book,
  credentials: AdobeCredentials | null,
): Promise<boolean> {
  let conversion = (book.conversion ?? {}) as Record<string, unknown>
  const sourceKey = typeof conversion.sourceKey === 'string' ? conversion.sourceKey : ''

  if (!sourceKey) {
    await fail(payload, book, 'The uploaded file is missing.')
    return true
  }

  if (
    !needsMasterRun({
      state: 'queued',
      exportJob: conversion.exportJob as string | null,
    })
  ) {
    return false
  }

  const kind = readSourceKind(conversion)
  const plan = resolvePlan(kind, conversion.plan)

  const filed = await fileOriginal(payload, book, { conversion, kind })
  if (filed === null) return true
  const artifacts = filed.artifacts
  conversion = filed.conversion

  if (!needsExport(kind, plan)) {
    const state = stateWithoutExport(kind, plan)
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: { ...conversion, state, message: null, ...correctionFor(conversion, state) },
        ...(state === 'ready' ? { status: 'published' as const } : {}),
      },
      overrideAccess: true,
    })
    return true
  }

  if (!credentials) {
    await noteWaiting(
      payload,
      book,
      conversion,
      'This scan is waiting to be read. The service that reads scanned pages is not configured on this deployment, so nothing has picked it up yet — your file and its details are safe, and it will convert as soon as it is.',
    )
    return false
  }

  try {
    const bytes = await artifactBytes(sourceKey)
    if (!bytes) {
      await fail(payload, book, 'The uploaded file could not be read from storage.')
      return true
    }

    if (!withinSizeLimit(bytes.byteLength)) {
      await fail(
        payload,
        book,
        'This PDF is larger than 100 MB, which is the most the conversion service accepts. A copy scanned at a lower resolution, or split into volumes, will work.',
      )
      return true
    }

    const hash = await sourceHash(bytes)
    const seen = await alreadyExported(payload, hash, book.id)
    if (seen) {
      const master = await artifactBytes(seen.storageKey)
      if (master) {
        return await attachMaster(payload, { ...book, artifacts }, {
          bytes: master,
          conversion: { ...conversion, sourceHash: hash },
          pageCount: seen.pageCount,
        })
      }
    }

    const token = await accessToken(credentials)
    const target = await createAsset(credentials, token)
    await uploadAsset(target.uploadUri, bytes)

    const jobUrl = await startExport({
      credentials,
      token,
      assetID: target.assetID,
      locale: exportLocaleFor(book.language),
    })

    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: {
          ...conversion,
          state: 'ocr',
          exportJob: jobUrl,
          exportAsset: target.assetID,
          exportStartedAt: new Date().toISOString(),
          sourceHash: hash,
          message: null,
        },
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    await failOrRetry(payload, book, conversion, {
      message: error instanceof Error ? error.message : 'The conversion could not be started.',
      retryable: isTransientExportFailure(error instanceof Error ? error.message : null),
    })
    return true
  }
}

export async function advanceRunningMaster(
  payload: Payload,
  credentials: AdobeCredentials,
): Promise<boolean> {
  const running = await payload.find({
    collection: 'books',
    where: { 'conversion.state': { equals: 'ocr' } },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const book = running.docs[0]
  if (!book) return false

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const jobUrl = typeof conversion.exportJob === 'string' ? conversion.exportJob : ''
  const assetID = typeof conversion.exportAsset === 'string' ? conversion.exportAsset : ''

  if (!jobUrl) {
    await fail(payload, book, 'The conversion was never started for this book.')
    return true
  }

  try {
    const token = await accessToken(credentials)
    const outcome = await exportStatus({ credentials, token, jobUrl })

    if (outcome.state === 'running') {
      if (exportHasExpired(conversion.exportStartedAt as string | null, Date.now())) {
        const retried = await failOrRetry(payload, book, conversion, {
          message: 'The conversion did not finish in time.',
          retryable: true,
        })
        if (retried && assetID) await deleteAsset(credentials, token, assetID)
        return true
      }
      return false
    }

    if (outcome.state === 'failed') {
      const retried = await failOrRetry(payload, book, conversion, {
        message: outcome.message ?? 'The pages could not be read.',
        retryable: outcome.retryable === true,
      })
      if (retried && assetID) await deleteAsset(credentials, token, assetID)
      return true
    }

    const master = await downloadResult(outcome.downloadUri!)
    const attached = await attachMaster(payload, book, { bytes: master, conversion })

    if (assetID) await deleteAsset(credentials, token, assetID)
    return attached
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The converted file could not be read.'

    const expired = exportHasExpired(conversion.exportStartedAt as string | null, Date.now())
    if (!expired && isTransientExportFailure(message)) {
      logError(`export: book ${book.id} could not be polled`, error)
      return false
    }

    await failOrRetry(payload, book, conversion, {
      message,
      retryable: expired || isTransientExportFailure(message),
    })
    return true
  }
}

export async function advanceMasterPipeline(payload: Payload): Promise<void> {
  try {
    const credentials = await adobeConfig()

    if (credentials && (await advanceRunningMaster(payload, credentials))) return
    await startNextMaster(payload, credentials)
  } catch (error) {
    logError('masterPipeline: advance', error)
  }
}

export async function settleQueuedBook(
  payload: Payload,
  bookId: string | number,
): Promise<boolean> {
  try {
    const book = await payload.findByID({
      collection: 'books',
      id: bookId,
      depth: 0,
      overrideAccess: true,
    })

    let conversion = (book.conversion ?? {}) as Record<string, unknown>
    if (conversion.state !== 'queued') return false

    const kind = readSourceKind(conversion)
    const plan = resolvePlan(kind, conversion.plan)

    if (typeof conversion.sourceKey !== 'string' || !conversion.sourceKey) return false

    const filed = await fileOriginal(payload, book, { conversion, kind })
    if (filed === null) return false
    conversion = filed.conversion

    if (needsExport(kind, plan)) return false

    const state = stateWithoutExport(kind, plan)
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: { ...conversion, state, message: null, ...correctionFor(conversion, state) },
        ...(state === 'ready' ? { status: 'published' as const } : {}),
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    logError('masterPipeline: settle queued book', error)
    return false
  }
}
