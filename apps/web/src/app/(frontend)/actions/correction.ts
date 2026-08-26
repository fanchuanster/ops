'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import {
  acceptDecisions,
  anyAdopted,
  canRequestCorrection,
  correctionStateForMaster,
  readCorrectionState,
  readSuggestions,
} from '../../../domain/correction'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { logError } from '../../../lib/logError'
import { artifactBytes, objectBucket } from '../../../lib/storage'

/**
 * The reader's half of AI correction: deciding what to adopt.
 *
 * CLAUDE.md section 7 requires the AI to propose rather than edit, with
 * a human approval between the proposal and the change. This file is
 * that approval. Nothing here talks to a model — the suggestions were
 * written by a converter and the decisions are read back by one; what
 * happens in between is a person reading their own book.
 *
 * **Whose decision.** The owner's, or an administrator's — the same
 * pair that chooses the cover, and for the same reason. The suggestions
 * are about the words of a book somebody uploaded, and rights,
 * visibility and level (the administrator's, section 6.1) are claims
 * about the *library*. What a line of your own book should say is not.
 */

export type CorrectionActionState = { error?: string; ok?: string }

/** The book, if this reader may decide about its text — otherwise null. */
async function correctableBook(
  payload: Awaited<ReturnType<typeof getPayload>>,
  bookId: number,
) {
  const user = await getCurrentUser()
  if (!user) return null

  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return null

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  return mine || isAdmin(user) ? book : null
}

/**
 * Read the suggestions a converter wrote for this book.
 *
 * Exported because the book page renders them and there is exactly one
 * correct way to do it: through the stored key, which the converter is
 * only permitted to set to something under this book's own prefix.
 * Returns an empty list rather than throwing — a missing or unreadable
 * file means there is nothing to decide, which the page can render.
 */
export async function loadSuggestions(bookId: number) {
  const payload = await getPayload({ config })
  const book = await correctableBook(payload, bookId)
  if (!book) return []

  const key = book.conversion?.correction?.suggestionsKey
  if (typeof key !== 'string' || !key) return []

  try {
    const bytes = await artifactBytes(key)
    if (!bytes) return []
    return readSuggestions(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    logError('correction: read suggestions', error)
    return []
  }
}

/**
 * Ask for corrections to be proposed, or proposed again.
 *
 * Only ever queues work — the proposing is a converter's, off the same
 * poll as everything else. Consent is re-checked here and again when
 * the job is handed out, because the uploader may untick the box
 * between the two and the later answer is the one that counts.
 */
export async function requestCorrection(
  _prev: CorrectionActionState,
  formData: FormData,
): Promise<CorrectionActionState> {
  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'That book could not be found.' }

  const payload = await getPayload({ config })
  const book = await correctableBook(payload, bookId)
  if (!book) return { error: 'That book could not be found.' }

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  const hasMaster = (book.artifacts ?? []).some((artifact) => artifact.format === 'docx')

  if (
    !canRequestCorrection({
      aiCorrection: conversion.aiCorrection,
      hasMaster,
      state: readCorrectionState(correction.state),
    })
  ) {
    return {
      error: hasMaster
        ? 'Corrections cannot be proposed for this book right now.'
        : 'There is no master to read yet. Corrections are proposed once the book has one.',
    }
  }

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        correction: {
          ...correction,
          state: correctionStateForMaster(conversion.aiCorrection),
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  revalidatePath(`/account/books/${bookId}`)
  return { ok: 'Queued. The suggestions will appear here once a converter has read the book.' }
}

/**
 * Record what the reader adopted, and queue the rewrite.
 *
 * The decisions file is written from the *stored* suggestions rather
 * than from the form. The form says only which addresses were ticked;
 * every line of text comes from the file the converter wrote. That is
 * the containment rule, and without it a crafted post would be an
 * arbitrary rewrite of any master — `acceptDecisions` drops an address
 * that was never offered.
 */
export async function recordDecisions(
  _prev: CorrectionActionState,
  formData: FormData,
): Promise<CorrectionActionState> {
  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'That book could not be found.' }

  const payload = await getPayload({ config })
  const book = await correctableBook(payload, bookId)
  if (!book) return { error: 'That book could not be found.' }

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  if (readCorrectionState(correction.state) !== 'ready') {
    return { error: 'There are no suggestions waiting for a decision on this book.' }
  }

  const offered = await loadSuggestions(bookId)
  if (offered.length === 0) {
    return { error: 'The suggestions for this book could not be read.' }
  }

  const decisions = acceptDecisions({
    offered,
    approved: formData.getAll('adopt').filter((v): v is string => typeof v === 'string'),
  })

  // Nothing adopted is a complete and legitimate answer — the model
  // found nothing worth changing, or the reader disagreed with all of
  // it. Recorded as a finished pass rather than sent to a converter
  // that would read the master, change nothing and write it back.
  if (!anyAdopted(decisions)) {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        conversion: {
          ...conversion,
          correction: { ...correction, state: 'applied', adopted: 0, message: null },
        },
      },
      overrideAccess: true,
    })
    revalidatePath(`/account/books/${bookId}`)
    return { ok: 'Nothing adopted. The book is unchanged.' }
  }

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Storage is not available right now.' }

  const key = `books/${bookId}/book/decisions.json`
  try {
    await bucket.put(
      key,
      new TextEncoder().encode(JSON.stringify({ suggestions: decisions }, null, 2)),
      { httpMetadata: { contentType: 'application/json' } },
    )
  } catch (error) {
    logError('correction: write decisions', error)
    return { error: 'The decisions could not be saved.' }
  }

  const adopted = decisions.filter((decision) => decision.approved).length
  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        correction: {
          ...correction,
          state: 'decided',
          decisionsKey: key,
          adopted,
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  revalidatePath(`/account/books/${bookId}`)
  return {
    ok: `${adopted} ${adopted === 1 ? 'correction' : 'corrections'} adopted. The master is being rewritten, and the reading edition will be rebuilt from it.`,
  }
}
