'use client'

import { useActionState } from 'react'

import { submitForReview, type DetailsState } from '../app/(frontend)/actions/bookDetails'

/**
 * Asking for a converted book to join the public library.
 *
 * Offered only on a finished book, and only as an option — a private
 * upload may stay private forever, which is the normal case and not the
 * lesser one. The rights answer is required here and nowhere else,
 * because this is the only point at which it matters.
 */
export function SubmitForReview({
  bookId,
  reviewState,
  rightsDeclared,
}: {
  bookId: number
  reviewState: string
  rightsDeclared: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(submitForReview, {})

  if (reviewState === 'submitted') {
    return (
      <p className="notice">
        Waiting to be reviewed. Your book stays private and readable by you in the meantime.
      </p>
    )
  }

  if (reviewState === 'approved') {
    return <p className="notice">Approved for the public library.</p>
  }

  return (
    <section className="submit-review">
      <h3>Share it with everyone?</h3>
      <p className="hint">
        Optional, and not the usual case. Your book works exactly as it does now if you keep it
        to yourself — forever, if you like. Submitting asks an administrator to consider it for
        the public library.
        {reviewState === 'rejected'
          ? ' A previous submission was not accepted; you can fix what was raised and submit again.'
          : ''}
      </p>

      {rightsDeclared ? (
        <form action={action}>
          <input type="hidden" name="bookId" value={bookId} />
          <button type="submit" className="button-quiet" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit for review'}
          </button>
          {state.error ? <p className="form-error">{state.error}</p> : null}
        </form>
      ) : (
        <p className="hint">
          Answer <strong>where this book came from</strong> above first. You are the only person
          who knows, and nobody downstream can answer it for you.
        </p>
      )}
    </section>
  )
}
