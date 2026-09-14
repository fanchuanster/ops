'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { releasedExportHandle, statusOnQueue } from '../../../domain/pipeline'
import { needsConverter, resolvePlan } from '../../../domain/publication'
import { canMasterFrom, readSources, switchedToSource } from '../../../domain/sources'
import { quotaMessage } from '../../../domain/uploadQuota'
import { getCurrentUser } from '../../../lib/auth'
import { logError } from '../../../lib/logError'
import { settleQueuedBook } from '../../../lib/masterPipeline'
import { checkQuotaFor } from '../../../lib/uploadQuota'

/**
 * Choosing which of a book's files the DOCX master is built from.
 *
 * A book may hold a scan and a transcription of the same work
 * (`domain/sources.ts`). Both can produce a master and they produce
 * very different ones: Adobe reading the scan costs money, takes
 * minutes and gets characters wrong, while the transcription is free,
 * instant and already right. Which to use is a judgement about the
 * files in front of you, so it belongs to the person who uploaded them
 * and it has to be changeable after they have seen the result.
 *
 * ## What this actually does
 *
 * Re-enters phase 1. Not phase 2 — the point is to build a *different*
 * master, so there is nothing to rebuild from yet. The book goes back to
 * `queued`, and from there the ordinary machinery decides what that
 * means for this source: an Adobe export for a PDF, a `master` job for a
 * text file, nothing at all for a DOCX, which is a master already
 * (`stateWithoutExport`).
 *
 * ## What it costs, and why it is charged
 *
 * A conversion, against the month's allowance. Re-mastering from a scan
 * is a full Adobe export at full price, so pretending it is free would
 * be letting one book spend a reader's whole month one click at a time.
 * `startedAt` is re-stamped for the same reason the plan flip re-stamps
 * it (`saveBookDetails`): the work is paid for in the month it happens
 * in, not the month the file was first uploaded.
 *
 * Deliberately charged even when the new source is a text file that
 * costs us nothing to read. The quota counts *conversions*, and a rule
 * that counted only the expensive ones would be a rule nobody could
 * predict — and a reader who wanted a free switch has one: the book
 * they already have.
 *
 * ## What it does not do
 *
 * It does not delete anything. The old master is overwritten in place
 * when the new one lands (`keyFor` in `lib/conversion/runner.ts`), and
 * the source it was built from stays filed under the book — so a reader
 * who changes their mind back has both files and one more conversion to
 * spend. Nothing here is one-way except the credits.
 */

export type SourceState = { error?: string }

export async function chooseMasterSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to convert.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const conversion = book.conversion ?? {}
  const wanted = String(formData.get('kind') || '')

  // Chosen from what the book actually holds, never from the posted
  // value. A form field is untrusted input, and the damage a bad one
  // does here is specific: `sourceKind` decides which formats phase 2
  // may build and whether Adobe is called at all, so a kind the book has
  // no file for would queue a conversion of nothing.
  const source = readSources(conversion, book.artifacts).find(
    (candidate) => candidate.kind === wanted,
  )
  if (!source) return { error: 'That file is not one of this book’s sources.' }
  if (!canMasterFrom(source.kind)) {
    return {
      error:
        'An EPUB is already a reading edition, so there is nothing to build from it. Choose the scan or the text.',
    }
  }

  // Already the chosen one. Answering "done" rather than re-queueing is
  // not politeness — a re-queue here would charge a conversion and
  // rebuild an identical master, which is the most expensive possible
  // way to do nothing.
  if (conversion.sourceKind === source.kind) return {}

  // Converting is what is being asked for, so the plan follows. A book
  // published as it stands whose owner picks a master source has just
  // said they want the reflowable edition after all.
  const plan = resolvePlan(source.kind, 'convert')

  if (needsConverter(source.kind, plan)) {
    const quota = await checkQuotaFor(payload, {
      userId: user.id,
      pagesRequested: book.estimatedPages ?? 0,
      isAdmin: Boolean(user.roles?.includes('admin')),
      // This book is already inside the month's usage — it has been
      // converted once. Counting it there *and* as the book being
      // requested would refuse a 700-page scan on the strength of
      // itself.
      excludeBookId: bookId,
    })
    if (!quota.allowed) {
      return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
    }
  }

  // The state as it stood when the book was read, which the write below
  // is conditional on. A cron tick may have claimed this book between
  // the two — the claim is a compare-and-swap on exactly this field
  // (`lib/conversion/runner.ts`) — and a plain write would then set
  // `queued` under a job that goes on to report `ready` over the top of
  // it. The switch would be lost with a green tick and no message, which
  // is the worst shape a failure can take.
  const observed = book.conversion?.state ?? 'none'

  let switched
  try {
    switched = await payload.update({
      collection: 'books',
      where: { and: [{ id: { equals: bookId } }, { 'conversion.state': { equals: observed } }] },
      data: {
        // Converting adds an edition and removes none, so a book that is
        // already readable must not drop out of the catalog for the
        // length of the rebuild (`statusOnQueue`).
        status: statusOnQueue((book.artifacts ?? []).map((artifact) => artifact.format)),
        conversion: {
          ...conversion,
          ...switchedToSource(source),
          state: 'queued',
          // Anything left from the *previous* source's export. Keyed on
          // `queued` like everywhere else, and here it is unambiguous:
          // whatever that job was, it was about a different file
          // (`releasedExportHandle`).
          ...releasedExportHandle('queued'),
          plan,
          message: null,
          // The suggestions on file were proposed against the master
          // that is about to be replaced, so they are about text that
          // will not exist. Cleared rather than left to be adopted into
          // a book they were never read from; `correctionStateForMaster`
          // queues a fresh pass when the new master lands, if the
          // uploader asked for one at all.
          correction: {
            ...(conversion.correction ?? {}),
            state: 'none' as const,
            count: null,
            adopted: null,
            message: null,
          },
          startedAt: new Date().toISOString(),
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('sources: choose master source', error)
    return { error: 'Could not switch to that file. Please try again.' }
  }

  if (switched.docs.length === 0) {
    // Somebody else moved the book while this was being decided — in
    // practice a tick that picked it up. Saying so and asking again is
    // the honest answer; retrying here would race the same job twice.
    return {
      error: 'This book moved on while you were choosing. Reload the page and try again.',
    }
  }

  // The same call the details form makes. For a DOCX source it finishes
  // phase 1 in this request — the file *is* the master — so the reader
  // is not left watching a queue for work that was never needed.
  await settleQueuedBook(payload, bookId)

  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  return {}
}
