'use client'

import { useActionState, useRef } from 'react'

import { removeBookCover, saveBookCover, type CoverState } from '../app/(frontend)/actions/cover'

export function CoverImageUpload({
  bookId,
  hasUploadedCover,
  bookIsPrivate,
}: {
  bookId: number
  hasUploadedCover: boolean
  bookIsPrivate: boolean
}) {
  const [saved, save, saving] = useActionState<CoverState, FormData>(saveBookCover, {})
  const [removed, remove, removing] = useActionState<CoverState, FormData>(removeBookCover, {})
  const form = useRef<HTMLFormElement>(null)

  const state = saved.error || saved.ok ? saved : removed
  const busy = saving || removing

  return (
    <div className="cover-upload">
      <form ref={form} action={save}>
        <input type="hidden" name="bookId" value={bookId} />

        <label className="cover-upload__btn button-quiet">
          <input
            type="file"
            name="cover"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy}
            onChange={(event) => {
              if (event.target.files?.length) form.current?.requestSubmit()
            }}
          />
          <span>
            {saving
              ? 'Uploading…'
              : hasUploadedCover
                ? 'Upload a different image'
                : 'Upload an image instead'}
          </span>
        </label>
      </form>

      {hasUploadedCover ? (
        <form action={remove}>
          <input type="hidden" name="bookId" value={bookId} />
          <button type="submit" className="button-quiet" disabled={busy}>
            {removing ? 'Removing…' : 'Remove it and use a page of the book'}
          </button>
        </form>
      ) : null}

      {bookIsPrivate ? (
        <p className="hint">
          Your book stays private, but an image you upload here is served from a public
          address — unlike a cover made from the book&rsquo;s own pages, which only you can
          see. Use a jacket photo rather than a page you would not publish.
        </p>
      ) : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.ok ? <p className="hint">{state.ok}</p> : null}
    </div>
  )
}
