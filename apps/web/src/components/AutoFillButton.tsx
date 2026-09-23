'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { identifyUpload, type IdentifyResult } from '../app/(frontend)/actions/identify'
import { makeCoversFromStored } from '../lib/client/coverImages'

const STATUS: Record<IdentifyResult, string> = {
  filled: 'Re-filled just now',
  nothing: 'Nothing found in the file names or first page',
  failed: 'Could not read the file. Please try again.',
}

export function AutoFillButton({
  bookId,
  needsFirstPage = false,
}: {
  bookId: number
  needsFirstPage?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rendering, setRendering] = useState(false)
  const [result, setResult] = useState<IdentifyResult | null>(null)

  function run() {
    setResult(null)
    startTransition(async () => {
      if (needsFirstPage) {
        setRendering(true)
        await makeCoversFromStored(bookId)
        setRendering(false)
      }
      const outcome = await identifyUpload(bookId)
      setResult(outcome)
      router.refresh()
    })
  }

  return (
    <div className="autofill">
      <span
        className={result === 'failed' ? 'autofill__status autofill__status--failed' : 'autofill__status'}
        role="status"
      >
        {rendering
          ? 'Rendering the first page…'
          : pending
            ? 'Reading the file names and first page — this can take a minute…'
            : result
              ? STATUS[result]
              : ''}
      </span>
      <button
        type="button"
        className="button-quiet autofill__button"
        onClick={run}
        disabled={pending}
        title="Sends the file names and first page to xAI, outside NobleSee, to read the title, author and language."
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 4v5h5M20 20v-5h-5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4.5 15a8 8 0 0013.9 3M19.5 9A8 8 0 005.6 6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {pending ? 'Auto-filling…' : 'Auto-fill with AI'}
      </button>
    </div>
  )
}
