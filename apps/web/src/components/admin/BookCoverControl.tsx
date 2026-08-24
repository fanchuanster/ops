'use client'

import { useActionState, useRef } from 'react'

import { removeBookCover, saveBookCover, type CoverState } from '../../app/(admin)/actions/cover'

/**
 * The book's face in the edit panel, and the way to change it.
 *
 * The picture shown is whatever a reader would see: an uploaded cover
 * if there is one, page one of the book if the converter has rendered
 * it, and the book's own first character if there is neither. That
 * ordering is `coverImageUrl` in `domain/cover.ts` and it is decided on
 * the server — this component is handed a URL and does not re-derive
 * it.
 *
 * The button submits on *choosing* a file rather than waiting for a
 * Save. Everything else in this panel is text an editor might mistype
 * and want to discard, which is what the explicit Save is for; picking
 * an image from a file dialog is already a deliberate act, and a chosen
 * cover sitting unsaved beside a preview that has not changed is a
 * worse state than no preview at all.
 *
 * Remove appears only when there is an upload to remove, because it is
 * not a way to have no cover — it falls back to page one.
 */
export function BookCoverControl({
  bookId,
  slug,
  coverUrl,
  hasUploadedCover,
  face,
}: {
  bookId: number
  slug: string
  coverUrl: string | null
  hasUploadedCover: boolean
  /** The book's first character, drawn when there is no picture at all. */
  face: string
}) {
  const [saved, save, saving] = useActionState<CoverState, FormData>(saveBookCover, {})
  const [removed, remove, removing] = useActionState<CoverState, FormData>(removeBookCover, {})
  const form = useRef<HTMLFormElement>(null)

  const state = saved.error || saved.ok ? saved : removed
  const busy = saving || removing

  return (
    <div className="admin-cover">
      <form ref={form} action={save} className="admin-cover__pick">
        <input type="hidden" name="bookId" value={bookId} />

        {coverUrl ? (
          <img className="admin-cover__img" src={coverUrl} alt="" />
        ) : (
          <span className="admin-face cjk" aria-hidden="true">
            {face}
          </span>
        )}

        <label className="admin-cover__btn" title="Upload a different cover">
          {/* A label rather than a button driving a hidden input: the
              file dialog then opens from the browser's own control, so
              it works with the keyboard and with no JavaScript beyond
              the submit below. */}
          <input
            type="file"
            name="cover"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy}
            onChange={(event) => {
              if (event.target.files?.length) form.current?.requestSubmit()
            }}
          />
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 11V3m0 0L5 6m3-3l3 3M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="visually-hidden">
            {saving ? 'Uploading a cover' : 'Upload a cover'}
          </span>
        </label>
      </form>

      {hasUploadedCover ? (
        <form action={remove}>
          <input type="hidden" name="bookId" value={bookId} />
          <input type="hidden" name="slug" value={slug} />
          <button type="submit" className="admin-linkbtn" disabled={busy}>
            {removing ? 'Removing…' : 'Use page one'}
          </button>
        </form>
      ) : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.ok ? <p className="admin-ok">{state.ok}</p> : null}
    </div>
  )
}
