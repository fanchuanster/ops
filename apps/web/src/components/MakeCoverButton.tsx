'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { coverImagesFor, type CoverSource } from '../lib/client/coverImages'

/**
 * Makes a cover for a book that is already in the library.
 *
 * The upload page renders the candidates while the file is still in the
 * browser, which is free and covers every book from here on. This is
 * for the ones that came before — and for a book whose cover came out
 * wrong, which is the same act.
 *
 * The work happens here, in whoever's browser pressed it: the book's
 * PDF is streamed back through `/covers/<id>/source` (owner or
 * administrator only), rasterized, and posted to `/covers/<id>`. That
 * means downloading the book to make a picture of its first page, which
 * for a 60 MB scan is a real wait on a slow connection — the button
 * says so rather than pretending otherwise.
 *
 * Nothing about this is a job, a queue or a poll. That is the point: a
 * cover used to be job kind three on a converter that claimed it and
 * never reported, and every book in the library had no picture as a
 * result.
 */
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

      // The route says which of the two it sent, so the renderer does
      // not have to sniff the bytes.
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
      // The picture is on this page and on several others; the server
      // has already revalidated them, and this is what redraws the one
      // being looked at.
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
