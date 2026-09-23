'use client'

import { useActionState } from 'react'

import { submitForReview, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { LEVEL_LABELS, levelFromId } from '../domain/levels'

function Timeline({ reached }: { reached: number }) {
  const steps = ['Uploaded', 'Editions built', 'Submitted for review', 'Editor’s decision', 'Published']

  return (
    <ol className="timeline">
      {steps.map((label, index) => {
        const done = index < reached
        return (
          <li key={label} data-done={done}>
            <span className="timeline__rail" aria-hidden="true">
              <span className="timeline__dot">{done ? '✓' : ''}</span>
              {index < steps.length - 1 ? <span className="timeline__line" /> : null}
            </span>
            <span className="timeline__label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function SubmitForReview({
  bookId,
  reviewState,
  reviewNote,
  proposedLevel,
  byAdmin = false,
}: {
  bookId: number
  reviewState: string
  reviewNote?: string | null
  proposedLevel?: number | null
  byAdmin?: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(submitForReview, {})


  if (reviewState === 'submitted') {
    return (
      <section className="submit-review">
        <h3>Under review</h3>
        <p className="hint">
          An editor will read it. This can take a while — your book is readable by you in the
          meantime, and nothing about it changes while you wait.
        </p>
        {proposedLevel ? (
          <p className="hint">
            You suggested it belongs in <strong>{LEVEL_LABELS[levelFromId(proposedLevel)]}</strong>.
            The editor decides where it lands.
          </p>
        ) : null}
        <Timeline reached={3} />
      </section>
    )
  }

  if (reviewState === 'approved') {
    return (
      <section className="submit-review">
        <h3>Approved for the public library</h3>
        {reviewNote ? (
          <div className="editor-note">
            <strong>Editor’s note</strong>
            <p>{reviewNote}</p>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section className="submit-review">
      <h3>{reviewState === 'rejected' ? 'Changes requested' : 'Share it with everyone?'}</h3>

      {reviewState === 'rejected' ? (
        <>
          <p className="hint">
            An editor read it and asked for a change before it joins the public library. Correct
            the master above and submit it again — this is a normal step, not a verdict.
          </p>
          {reviewNote ? (
            <div className="editor-note">
              <strong>Editor’s note</strong>
              <p>{reviewNote}</p>
            </div>
          ) : null}
        </>
      ) : byAdmin ? (
        <p className="hint">
          Optional. Keeping it private changes nothing about how it works for you. You are an
          administrator, so this publishes the book rather than queueing it.
        </p>
      ) : (
        <p className="hint">
          Optional. Keeping it private changes nothing about how it works for you. Submitting asks
          an administrator to consider it for the public library.
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="bookId" value={bookId} />

        <button type="submit" className="cta" disabled={pending}>
          {pending
            ? byAdmin
              ? 'Publishing…'
              : 'Submitting…'
            : byAdmin
              ? 'Publish to the library'
              : 'Submit to the public library'}
        </button>

        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    </section>
  )
}
