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
  canApprove: boolean
  alreadyPublic: boolean
  rightsCleared: boolean
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

  useOnSaved(approveState, () => router.replace(closeHref, { scroll: false }))
  useOnSaved(changesState, () => router.replace(closeHref, { scroll: false }))

  return (
    <section className="admin-decision">
      <h3>Decision</h3>

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
