'use client'

import { useActionState } from 'react'

import { retryConversion, type ManageState } from '../app/(frontend)/actions/manageBook'

export function RetryConversion({ bookId }: { bookId: number }) {
  const [state, retry, retrying] = useActionState<ManageState, FormData>(retryConversion, {})

  return (
    <form action={retry} className="retry-conversion">
      <input type="hidden" name="bookId" value={bookId} />
      <button type="submit" className="button-quiet" disabled={retrying}>
        {retrying ? 'Queueing…' : 'Try converting again'}
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
