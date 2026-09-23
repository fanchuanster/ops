'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { type CoverFailure, makeCoversFromStored } from '../lib/client/coverImages'

type Failure = CoverFailure | 'source'

const FAILURES: Record<Failure, string> = {
  source: 'This book’s file could not be read from storage.',
  unreadable:
    'This book’s file could not be opened — it may be incomplete. Upload the whole file again.',
  empty: 'No cover could be made from this book.',
  store: 'That cover could not be saved. Please try again.',
}

export function MakeCoverButton({
  bookId,
  label = 'Make a cover from the book',
  className = 'admin-linkbtn',
}: {
  bookId: number
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'rendering' | Failure>('idle')

  async function run() {
    setState('rendering')
    const attempt = await makeCoversFromStored(bookId)
    if (!attempt.ok) return setState(attempt.reason)

    setState('idle')
    router.refresh()
  }

  const busy = state === 'rendering'
  const failure = state === 'idle' || busy ? null : FAILURES[state]

  return (
    <>
      <button type="button" className={className} onClick={run} disabled={busy}>
        {busy ? 'Rendering…' : label}
      </button>
      {failure ? <p className="form-error">{failure}</p> : null}
    </>
  )
}
