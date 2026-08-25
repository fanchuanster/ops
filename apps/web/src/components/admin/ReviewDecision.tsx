'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import {
  approveSubmission,
  requestChanges,
  type ReviewState as ActionState,
} from '../../app/(admin)/actions/review'
import type { ReviewState } from '../../domain/moderation'
import { useOnSaved } from './useOnSaved'

/**
 * The editor's decision, and the words that go with it.
 *
 * Two buttons:
 *
 *   Approve          — this belongs in the library, and publishing it
 *                      is the same act. There is no separate Publish.
 *   Request changes  — not yet, and here is why.
 *
 * Publish was a third button until 2026-08-24. Approving without
 * publishing produced a state nobody could explain — an "Approved" chip
 * on a book still invisible to every reader — so the two collapsed into
 * one, and the rights gate moved in front: a submission whose rights do
 * not permit distribution cannot be approved at all, and the button is
 * disabled rather than offered and then refused. That is what the
 * design draws, and `actions/review.ts` enforces it on the server
 * whatever this component renders.
 *
 * The note is required to request changes and optional to approve. That
 * asymmetry is the point: a rejection without a reason is not a review,
 * while an approval explains itself by the book appearing.
 *
 * A decision closes the panel, like every other editing surface in the
 * admin (`useOnSaved`). It is the strongest case for it: a reviewed
 * book leaves the queue behind the panel, so what the panel is showing
 * after an approval is a submission that is no longer waiting for one.
 *
 * The design has a fourth control, a permanent Reject distinct from
 * requesting changes. There is no such state in `domain/moderation.ts`
 * and one was not invented here — `rejected` is explicitly
 * resubmittable, the uploader's own screen has always called it
 * "Changes requested", and a queue that called the identical row
 * "Rejected" would be the two halves of one conversation using
 * different words.
 */

export function ReviewDecision({
  bookId,
  reviewState,
  note: savedNote,
  canApprove,
  alreadyPublic,
  rightsCleared,
  closeHref,
}: {
  bookId: number
  reviewState: ReviewState
  note: string
  /** Whether approving would actually work — the domain's answer, not a guess. */
  canApprove: boolean
  alreadyPublic: boolean
  /** Whether the rights permit public distribution — the gate nobody waives. */
  rightsCleared: boolean
  /** Where the panel goes when the decision is made. */
  closeHref: string
}) {
  const [approveState, approve, approving] = useActionState<ActionState, FormData>(
    approveSubmission,
    {},
  )
  const [changesState, change, changing] = useActionState<ActionState, FormData>(
    requestChanges,
    {},
  )

  const router = useRouter()

  const [note, setNote] = useState(savedNote)
  const busy = approving || changing
  const result = approveState.error || changesState.error
  const done = approveState.ok || changesState.ok

  // Either decision closes the panel. Both are terminal: the book is
  // published, or its uploader has been asked for changes, and neither
  // leaves anything else to do on this screen.
  useOnSaved(approveState, () => router.replace(closeHref, { scroll: false }))
  useOnSaved(changesState, () => router.replace(closeHref, { scroll: false }))

  return (
    <section className="admin-decision">
      <h3>Decision</h3>

      {/* One textarea, two forms. The value is mirrored into a hidden
          field in each so whichever button is pressed carries the same
          words — a textarea can only live inside one form. */}
      <label className="visually-hidden" htmlFor="editor-note">
        Note to the uploader
      </label>
      <textarea
        id="editor-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Shown to the uploader. Required when you ask for changes."
        rows={4}
      />

      <div className="admin-decision__buttons">
        <form action={approve}>
          <input type="hidden" name="bookId" value={bookId} />
          <input type="hidden" name="note" value={note} />
          <button
            type="submit"
            className="admin-btn admin-btn--approve"
            disabled={busy || !canApprove}
          >
            {approving
              ? 'Approving…'
              : alreadyPublic
                ? 'In the library'
                : 'Approve and publish'}
          </button>
        </form>

        <form action={change}>
          <input type="hidden" name="bookId" value={bookId} />
          <input type="hidden" name="note" value={note} />
          <button type="submit" className="admin-btn admin-btn--quiet" disabled={busy}>
            {changing ? 'Sending…' : 'Request changes'}
          </button>
        </form>
      </div>

      {alreadyPublic ? (
        <p className="admin-quiet admin-decision__state">
          It is in the public library. Requesting changes tells its uploader what to fix; it does
          not withdraw the book.
        </p>
      ) : !rightsCleared ? (
        <p className="admin-quiet admin-decision__state">
          Its rights do not permit public distribution, so it cannot be approved — approving is
          what publishes it. Its uploader keeps every other thing the library offers. That gate is
          not an administrator’s to open.
        </p>
      ) : !canApprove ? (
        <p className="admin-quiet admin-decision__state">
          Its uploader has not offered it to the library. You can approve a submission early; you
          cannot make one on somebody else’s behalf.
        </p>
      ) : reviewState === 'rejected' ? (
        <p className="admin-quiet admin-decision__state">
          Changes were requested. Approving now publishes it as it stands.
        </p>
      ) : null}

      {result ? <p className="form-error">{result}</p> : null}
      {done && !result ? <p className="admin-ok">{done}</p> : null}
    </section>
  )
}
