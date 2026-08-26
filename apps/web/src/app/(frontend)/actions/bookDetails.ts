'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import {
  type SubmissionBlockedReason,
  canPublishToLibrary,
  canSubmitForReview,
} from '../../../domain/moderation'
import { levelId, parseProposedLevel } from '../../../domain/levels'
import {
  hasMaster,
  isConversionState,
  recoversFromFailure,
  stateAfterMasterEdit,
} from '../../../domain/pipeline'
import { isUploaderSelectableRights, type RightsStatus } from '../../../domain/rights'
import { quotaMessage } from '../../../domain/uploadQuota'
import {
  needsConverter,
  readSourceKind,
  reopensForConversion,
  resolvePlan,
} from '../../../domain/publication'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { objectBucket } from '../../../lib/storage'
import { checkQuotaFor } from '../../../lib/uploadQuota'
import { logError } from '../../../lib/logError'
import { settleQueuedBook } from '../../../lib/masterPipeline'

/**
 * Confirming the details of an uploaded book.
 *
 * Everything on this form was suggested by reading the file; this is
 * where the reader corrects it. The fields they may set are exactly the
 * bibliographic ones — what the book *is*. Visibility, reading level
 * and the review outcome are administrator fields (CLAUDE.md section
 * 6.1) and are not in this form, because an uploader who could set them
 * would walk their upload into the front of the library.
 *
 * Two ways out, and the difference is only whether the reader is asking
 * for the book to be published:
 *
 *   - **Convert** — the book stays private to them, forever if they
 *     like. This is the normal case and needs nobody's approval.
 *   - **Convert and submit for review** — the same, plus a request that
 *     an administrator consider it for the public library. That is a
 *     separate act on a finished book now, and it is where the rights
 *     question is asked (`submitForReview` below). This action still
 *     accepts a `rightsStatus` if one is posted, so a page cached from
 *     before the move does not silently drop the answer.
 */

export type DetailsState = { error?: string }

export async function saveBookDetails(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to save.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  // Not found and not yours are the same answer. Whether a book exists
  // is not something to leak through an edit form.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const title = String(formData.get('title') || '').trim()
  if (!title) return { error: 'Give the book a title.' }

  const rightsStatus = String(formData.get('rightsStatus') || '')

  // May be left unanswered here. It is only load-bearing when the reader
  // asks for the book to be published, which is a separate act.
  if (rightsStatus && !isUploaderSelectableRights(rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }

  // One shelf, so the first legible value wins rather than a list.
  const rawCollection = Number(formData.get('collection'))
  const collectionId = Number.isInteger(rawCollection) && rawCollection > 0 ? rawCollection : null

  const language = String(formData.get('language') || '')

  // The monthly conversion allowance, checked at the moment conversion
  // would start rather than at upload — a draft costs nothing, and
  // refusing an upload for drafts the reader may never convert would
  // charge them for a decision they have not made.
  //
  // Only for a book that has not already been through the pipeline: a
  // reader correcting the details of a converted book is not asking for
  // it to be converted again.
  const alreadyConverting = book.conversion?.state !== 'draft'

  const sourceKind = readSourceKind(book.conversion ?? {})
  const previousPlan = resolvePlan(sourceKind, book.conversion?.plan)
  const plan = resolvePlan(sourceKind, formData.get('plan'))

  // **Changing your mind, which is now the ordinary path.**
  //
  // Publishing a PDF as it stands is the default (`defaultPlanFor`), so
  // the reader who wants a reflowable edition arrives here *after* the
  // book has already settled — and settled means `ready`, which
  // `alreadyConverting` reads as "do not touch the state". Without this,
  // such a book would record the new plan and then sit there for ever,
  // finished, with nothing queued and no EPUB coming.
  //
  // The rule is `reopensForConversion`; what this line adds is only
  // *when* it applies — to a book already past `draft`, since a draft
  // is queued by this same save anyway.
  const startsConverting =
    alreadyConverting && reopensForConversion(sourceKind, previousPlan, plan)

  // **The other direction: a failure nothing will retry.**
  //
  // A book published as it stands needs no converter, so a conversion
  // failure on it is about work nobody wants any more — and it is what
  // stops the book being read, reviewed or published. `recoversFromFailure`
  // is the rule; here it means "re-queue it, and the settle below will
  // finish it in this same request".
  const rescuesFromFailure = recoversFromFailure({
    state: isConversionState(book.conversion?.state) ? book.conversion.state : 'none',
    sourceKind,
    plan,
  })

  // The quota counts conversions, so a book that will not be converted
  // does not consume one. Publishing a PDF as it stands, or filing an
  // uploaded EPUB, costs no pages read and no rendering — charging for
  // it would be charging for a decision to *not* use the pipeline.
  //
  // Which is also why the flip above is checked here: the decision not
  // to convert is being reversed, and that is the moment the cost is
  // actually incurred.
  if ((!alreadyConverting || startsConverting) && needsConverter(sourceKind, plan)) {
    const quota = await checkQuotaFor(payload, {
      userId: user.id,
      pagesRequested: book.estimatedPages ?? 0,
      isAdmin: Boolean(user.roles?.includes('admin')),
      // This book is past `draft` on the flip, so it is already inside
      // the month's own usage. Counting it there *and* as the book
      // being requested would charge a 700-page scan 1400 pages and
      // refuse it on the strength of itself.
      excludeBookId: bookId,
    })
    if (!quota.allowed) {
      // The draft survives, deliberately. The book is not the problem;
      // the month is.
      return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
    }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        title,
        author: String(formData.get('author') || '').trim() || null,
        // Original title joined the form on 2026-08-21. It was left
        // off on the argument that it is curatorial rather than
        // something an uploader confirming their own scan can answer —
        // which does not survive how extraction actually works: for a
        // Chinese classic the file's own metadata usually *is* the
        // original title, so the field arrives filled in and the reader
        // is confirming rather than composing. Translator came with it
        // and left on 2026-08-25: nothing extracts one, so it was
        // always an empty box asking for prose.
        //
        // Description is still not here, and that one does hold: it is
        // written, not read off anything, and an empty box asking for
        // prose is the field that stops a form being finished.
        originalTitle: String(formData.get('originalTitle') || '').trim() || null,
        ...(language ? { language: language as 'zh-Hant' } : {}),
        ...(rightsStatus ? { rightsStatus: rightsStatus as 'user_owned' } : {}),
        collection: collectionId,
        // Only while the book is on its way through the pipeline.
        // Setting it unconditionally would take a finished book — which
        // a PDF published as it stands is the moment it settles — and
        // quietly move it back out of `published`, where the catalog
        // query and `authorizeDownload` both look for it, because
        // somebody corrected its title.
        ...(alreadyConverting && !startsConverting && !rescuesFromFailure
          ? {}
          : { status: 'in_production' as const }),
        // Queued either way. A reader who is not asking for publication
        // still wants their EPUB.
        conversion: {
          ...book.conversion,
          state:
            alreadyConverting && !startsConverting && !rescuesFromFailure
              ? book.conversion?.state
              : 'queued',
          // What the uploader chose, narrowed to what this source can
          // actually do. A form value is untrusted input: asking for
          // `as_is` on a DOCX would publish a Word file as a book.
          plan,
          // Whether they asked for AI-assisted correction, which sends
          // their text to a third-party model. An unchecked box and a
          // missing field are the same answer, and it is no.
          aiCorrection: formData.get('aiCorrection') === 'on',
          // Stamped when the book enters the pipeline. This is what the
          // monthly count is scoped by, which is why the flip re-stamps
          // it: the conversion is being paid for in *this* month, not
          // in whichever month the file was first uploaded as it stood.
          startedAt: startsConverting
            ? new Date().toISOString()
            : (book.conversion?.startedAt ?? new Date().toISOString()),
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('bookDetails: save details', error)
    return { error: 'Could not save those details. Please try again.' }
  }

  // A book with nothing to convert is finished the moment its original
  // is filed under it, so finish it here rather than leaving it queued
  // for a converter with no work to do. Without this, "publish it as it
  // stands" produced a book that could not be read, reviewed or
  // published on any deployment where no converter happened to be
  // polling — which is most of them, since such a book needs none.
  //
  // Never throws, and a false answer is not an error: anything it
  // declines to settle is still queued for the pipeline tick.
  if (!needsConverter(sourceKind, plan)) await settleQueuedBook(payload, bookId)

  revalidatePath('/account/books')
  revalidatePath(`/account/books/${bookId}`)
  redirect(`/account/books/${bookId}`)
}

/**
 * Ask for a converted book to be considered for the public library.
 *
 * Separate from confirming the details, and offered only once there is
 * a converted book to look at — asking someone to decide about
 * publication before they have seen a single converted page is asking
 * them to guess.
 *
 * Approval is not the only gate. An administrator saying yes means the
 * book belongs in the library; it is not a finding that it is legally
 * distributable, which is what the rights status decides separately
 * (domain/moderation.ts).
 *
 * The reading level is posted with it too, and it is a *proposal*: the
 * uploader knows their book better than anyone and is the cheapest
 * person to ask where it sits, but where it sits is a curatorial
 * judgement and stays the administrator's. So the answer is recorded on
 * the submission and nothing acts on it — `level` is not written here,
 * and approving does not copy it across (`domain/moderation.ts`).
 *
 * The rights answer is posted with the submission, and this is the only
 * place it is asked. It used to be a select on the details form, which
 * put a legal question in front of someone whose book was still a
 * private draft they might never publish — and made an optional flow
 * read like a submission. Recorded here *before* the gate is evaluated,
 * so an answer that turns out to block publication is still saved: the
 * book keeps it, the reader is told why, and nothing has to be retyped.
 */
export async function submitForReview(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to submit.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to submit.' }
  }

  // Saved whatever it says, including an answer that cannot lead to
  // publication. `user_owned` is a true fact about the book and the
  // reader should not have to state it twice; the gate below is what
  // decides what follows from it.
  const rightsStatus = String(formData.get('rightsStatus') || '')
  if (rightsStatus && !isUploaderSelectableRights(rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }

  if (rightsStatus && rightsStatus !== book.rightsStatus) {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { rightsStatus: rightsStatus as 'user_owned' },
      overrideAccess: true,
    })
  }

  const decision = canSubmitForReview({
    reviewState: book.review?.state ?? 'unsubmitted',
    rightsStatus: (rightsStatus || book.rightsStatus) as typeof book.rightsStatus,
    // The DOCX master, not the EPUB. Review now comes *before* the
    // reader-facing formats are built — that is the whole point of the
    // gate — so requiring an EPUB here would mean no book could ever be
    // submitted and none could ever be approved.
    hasContent: hasMaster(
      isConversionState(book.conversion?.state) ? book.conversion.state : 'none',
    ),
  })
  if (!decision.allowed) return { error: SUBMISSION_ERRORS[decision.reason] }

  // No preference is the ordinary answer and is stored as one: null,
  // rather than the default level, so a reviewer can tell "they think
  // it is normal" apart from "they did not say".
  const proposed = parseProposedLevel(formData.get('proposedLevel'))

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      review: {
        ...book.review,
        state: 'submitted',
        submittedAt: new Date().toISOString(),
        proposedLevel: proposed ? levelId(proposed) : null,
      },
    },
    overrideAccess: true,
  })

  // An administrator submitting their *own* book is both parties to the
  // review: they are offering it and they are the person who would
  // approve it. Sending it to a queue for themselves to find would be a
  // round trip through a screen to reach a decision they have already
  // made — so it goes straight into the library.
  //
  // Only the review gate is skipped. The rights answer they just gave is
  // still what decides, exactly as it would for anybody else, and an
  // administrator whose own book is `user_owned` gets the same private
  // book a reader would.
  let published = false
  if (isAdmin(user)) {
    const publication = canPublishToLibrary({
      reviewState: 'submitted',
      rightsStatus: (rightsStatus || book.rightsStatus || 'unknown') as RightsStatus,
      byAdmin: true,
      ownedByRequester: true,
    })

    if (publication.allowed) {
      try {
        await payload.update({
          collection: 'books',
          id: bookId,
          data: { visibility: 'public' },
          overrideAccess: true,
          // The hook reads this to know whose act it is, and records the
          // approval against them (`collections/Books.ts`).
          user,
        })
        published = true
        revalidatePath('/')
        revalidatePath('/books')
      } catch (error) {
        // The submission stands whatever happened here. It is in the
        // queue, and the queue's Publish button is the other way in.
        logError('bookDetails.submit.publishAsAdmin', error)
      }
    }
  }

  revalidatePath(`/account/books/${bookId}`)

  // Publishing ends the editing. The book is in the library, there is
  // nothing further to do to it on this screen, and leaving the uploader
  // on it means one more click before they can start the next book — so
  // it closes the way every panel in the admin now closes, by going back
  // to the list. `My books` says "In the public library" against the row,
  // which is the confirmation the page would have shown in place.
  //
  // Only when it actually published. A submission that is waiting for a
  // reviewer has something left to show — "Under review", the note, the
  // timeline — and the list has no column for any of it.
  if (published) {
    revalidatePath('/account/books')
    redirect('/account/books')
  }

  return {}
}

/** What a blocked submission should tell the uploader. */
const SUBMISSION_ERRORS: Record<SubmissionBlockedReason, string> = {
  already_submitted: 'This book is already waiting to be reviewed.',
  already_approved: 'This book has already been approved.',
  rights_undeclared:
    'Say where this book came from before submitting it. You are the only person who knows.',
  no_content: 'There is nothing to review yet.',
}

/**
 * Replace the DOCX master with an edited one.
 *
 * The other half of what makes a draft a workspace. A conversion from a
 * scan is a first pass — the uploader is the one who can see what the
 * OCR misread — so they download the master, fix it, and send it back.
 *
 * The replacement becomes the new source and the book re-enters
 * conversion, which regenerates the EPUB and the PDFs from it. It does
 * *not* cost another slot against the monthly quota: this is the same
 * book being corrected, and charging for a correction would discourage
 * exactly the proofreading this project exists to do.
 */
export async function replaceMaster(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to replace.' }

  const file = formData.get('master')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a DOCX to upload.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const state = book.conversion?.state
  const next = isConversionState(state) ? stateAfterMasterEdit(state) : null
  if (!next) {
    return { error: 'There is no master to replace yet. Wait for the conversion to finish.' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Checked by content rather than by `file.type`, which is whatever the
  // browser guessed from the extension and is routinely empty. A file
  // that is not really a DOCX otherwise fails deep inside the converter,
  // minutes later, as an error about XML — where the person who could
  // fix it will never see it. Every DOCX is a zip, and every zip starts
  // `PK`.
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return { error: 'That does not look like a Word document.' }
  }

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Uploads are not available on this server yet.' }

  // A new key rather than overwriting the old one, so a replacement that
  // turns out worse than the original has not destroyed it. Under the
  // book's own prefix, which is the containment rule every artifact key
  // obeys (domain/conversion.ts).
  const storageKey = `books/${bookId}/book/master-${crypto.randomUUID()}.docx`

  try {
    await bucket.put(storageKey, bytes, {
      httpMetadata: {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    })

    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        // The master artifact now points at the corrected file. Other
        // formats are left alone: they are about to be rebuilt from it,
        // and removing them here would blank the book in the meantime.
        artifacts: [
          ...(book.artifacts ?? []).filter((artifact) => artifact.format !== 'docx'),
          { format: 'docx' as const, storageKey, downloadable: false },
        ],
        // Phase 2, and only phase 2. This is the point of splitting
        // production in two: a correction costs a rebuild of the
        // formats, never a re-read of the pages (domain/pipeline.ts).
        conversion: { ...book.conversion, state: next, message: null },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('bookDetails: replace master', error)
    return { error: 'Could not replace the master. Please try again.' }
  }

  revalidatePath(`/account/books/${bookId}`)
  return {}
}
