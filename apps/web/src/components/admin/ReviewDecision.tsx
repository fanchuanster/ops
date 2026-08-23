'use client'

import { useActionState, useState } from 'react'

import {
  approveSubmission,
  publishToLibrary,
  requestChanges,
  type ReviewState as ActionState,
} from '../../app/(admin)/actions/review'
import type { ReviewState } from '../../domain/moderation'

/**
 * The editor's decision, and the words that go with it.
 *
 * Three buttons at most, and they are not three grades of the same
 * verdict:
 *
 *   Approve          — editorial. This belongs in the library.
 *   Request changes  — editorial. Not yet, and here is why.
 *   Publish          — the separate act that actually makes it public,
 *                      offered only when the rights permit it.
 *
 * Publish no longer waits for Approve. An administrator publishing a
 * book is approving it, so the button is offered on a submission that
 * has not been approved yet and the write records the approval it
 * implies. Approve still exists on its own, because approving without
 * publishing is a real thing to want — a book whose rights are not
 * cleared can be judged worth having and still stay private.
 *
 * The design has a fourth, a permanent Reject distinct from requesting
 * changes. There is no such state in `domain/moderation.ts` and one was
 * not invented here — `rejected` is explicitly resubmittable, the
 * uploader's own screen has always called it "Changes requested", and
 * a queue that called the identical row "Rejected" would be the two
 * halves of one conversation using different words.
 *
 * A note is required to request changes and optional to approve. That
 * asymmetry is the point: a rejection without a reason is not a review,
 * while an approval explains itself by the book appearing.
 */

export function ReviewDecision({
  bookId,
  reviewState,
  note: savedNote,
  canPublish,
  alreadyPublic,
  rightsCleared,
}: {
  bookId: number
  reviewState: ReviewState
  note: string
  canPublish: boolean
  alreadyPublic: boolean
  /** Whether the rights permit public distribution — the gate nobody waives. */
  rightsCleared: boolean
}) {
  const [approveState, approve, approving] = useActionState<ActionState, FormData>(
    approveSubmission,
    {},
  )
  const [changesState, change, changing] = useActionState<ActionState, FormData>(
    requestChanges,
    {},
  )
  const [publishState, publish, publishing] = useActionState<ActionState, FormData>(
    publishToLibrary,
    {},
  )

  const [note, setNote] = useState(savedNote)
  const busy = approving || changing || publishing
  const result = approveState.error || changesState.error || publishState.error
  const done = approveState.ok || changesState.ok || publishState.ok

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
          <button type="submit" className="admin-btn admin-btn--approve" disabled={busy}>
            {approving ? 'Approving…' : reviewState === 'approved' ? 'Approved' : 'Approve'}
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
        <p className="admin-quiet admin-decision__state">It is in the public library.</p>
      ) : canPublish ? (
        <form action={publish} className="admin-decision__publish">
          <input type="hidden" name="bookId" value={bookId} />
          <button type="submit" className="admin-btn admin-btn--publish" disabled={busy}>
            {publishing ? 'Publishing…' : 'Publish to the library'}
          </button>
          <p className="admin-quiet">
            {reviewState === 'approved'
              ? 'Approving said it belongs here; this is what puts it in front of everyone.'
              : 'This approves it and publishes it in one act — you do not have to approve it first.'}
          </p>
        </form>
      ) : !rightsCleared ? (
        <p className="admin-quiet admin-decision__state">
          Its rights do not permit public distribution, so it stays private whatever you decide
          here — and its uploader keeps every other thing the library offers. That gate is not an
          administrator’s to open.
        </p>
      ) : null}

      {result ? <p className="form-error">{result}</p> : null}
      {done && !result ? <p className="admin-ok">{done}</p> : null}
    </section>
  )
}
