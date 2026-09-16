'use client'

import { useActionState, useRef } from 'react'

import {
  removeBookCover,
  saveBookCover,
  type CoverState,
} from '../../app/(frontend)/actions/cover'
import { CoverPagePicker } from '../CoverPagePicker'
import { MakeCoverButton } from '../MakeCoverButton'

export function BookCoverControl({
  bookId,
  coverUrl,
  hasUploadedCover,
  canMakeCover,
  coverPage,
  coverPages,
  hasRendered,
  face,
}: {
  bookId: number
  coverUrl: string | null
  hasUploadedCover: boolean
  canMakeCover: boolean
  coverPage: number
  coverPages: number[]
  hasRendered: boolean
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
          <button type="submit" className="admin-linkbtn" disabled={busy}>
            {removing ? 'Removing…' : 'Use page one'}
          </button>
        </form>
      ) : null}

      {hasUploadedCover || !canMakeCover || hasRendered ? null : (
        <p className="admin-cover__make">
          <MakeCoverButton bookId={bookId} label="Make a cover" />
        </p>
      )}

      {hasUploadedCover ? null : (
        <CoverPagePicker
          bookId={bookId}
          page={coverPage}
          pages={coverPages}
          className="coverpick--admin"
        />
      )}

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.ok ? <p className="admin-ok">{state.ok}</p> : null}
    </div>
  )
}
