'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  type CoverFailure,
  type CoverSource,
  makeCoversFor,
} from '../lib/client/coverImages'

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
  const [state, setState] = useState<'idle' | 'reading' | 'rendering' | Failure>('idle')

  async function run() {
    setState('reading')

    const response = await fetch(`/covers/${bookId}/source`).catch(() => null)
    if (!response?.ok) return setState('source')

    const source = (response.headers.get('X-Cover-Source') ?? 'pdf') as CoverSource
    const file = await response.blob().catch(() => null)
    if (!file) return setState('source')

    setState('rendering')
    const attempt = await makeCoversFor(bookId, file, source)
    if (!attempt.ok) return setState(attempt.reason)

    setState('idle')
    router.refresh()
  }

  const busy = state === 'reading' || state === 'rendering'
  const failure = state === 'idle' || busy ? null : FAILURES[state]

  return (
    <>
      <button type="button" className={className} onClick={run} disabled={busy}>
        {state === 'reading'
          ? 'Reading the book…'
          : state === 'rendering'
            ? 'Rendering…'
            : label}
      </button>
      {failure ? <p className="form-error">{failure}</p> : null}
    </>
  )
}
