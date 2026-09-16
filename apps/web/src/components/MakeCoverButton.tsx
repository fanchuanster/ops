'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { coverImagesFor, type CoverSource } from '../lib/client/coverImages'

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
  const [state, setState] = useState<'idle' | 'reading' | 'rendering' | 'failed'>('idle')

  async function run() {
    setState('reading')
    try {
      const response = await fetch(`/covers/${bookId}/source`)
      if (!response.ok) return setState('failed')

      const source = (response.headers.get('X-Cover-Source') ?? 'pdf') as CoverSource
      const file = await response.blob()

      setState('rendering')
      const images = await coverImagesFor(file, source)
      if (images.length === 0) return setState('failed')

      const body = new FormData()
      for (const image of images) body.append('pages', image, 'page.jpg')

      const stored = await fetch(`/covers/${bookId}`, { method: 'POST', body })
      if (!stored.ok) return setState('failed')

      setState('idle')
      router.refresh()
    } catch {
      setState('failed')
    }
  }

  const busy = state === 'reading' || state === 'rendering'

  return (
    <>
      <button type="button" className={className} onClick={run} disabled={busy}>
        {state === 'reading'
          ? 'Reading the book…'
          : state === 'rendering'
            ? 'Rendering…'
            : label}
      </button>
      {state === 'failed' ? (
        <p className="form-error">No cover could be made from this book.</p>
      ) : null}
    </>
  )
}
