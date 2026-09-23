import React from 'react'

import { CoverImageUpload } from './CoverImageUpload'
import { CoverPagePicker } from './CoverPagePicker'
import { MakeCoverButton } from './MakeCoverButton'

export function BookCover({
  bookId,
  title,
  coverUrl,
  alt,
  uploaded,
  page,
  pages,
  canMake,
  isPrivate,
}: {
  bookId: number
  title: string
  coverUrl: string | null
  alt: string
  uploaded: boolean
  page: number
  pages: number[]
  canMake: boolean
  isPrivate: boolean
}) {
  return (
    <div className="cover-panel__body">
      {coverUrl ? (
        <img className="cover-panel__img" src={coverUrl} alt={alt} />
      ) : (
        <span className="cover-panel__img cover-panel__img--empty cjk" aria-hidden="true">
          {Array.from(title.trim())[0] ?? '·'}
        </span>
      )}
      <div>
        {uploaded ? (
          <p className="hint">
            This book is wearing an uploaded image rather than a page of itself.
          </p>
        ) : (
          <>
            <CoverPagePicker bookId={bookId} page={page} pages={pages} />
            {canMake ? (
              <p className="cover-panel__make">
                <MakeCoverButton bookId={bookId} className="button-quiet" />
              </p>
            ) : null}
          </>
        )}
        <CoverImageUpload bookId={bookId} hasUploadedCover={uploaded} bookIsPrivate={isPrivate} />
      </div>
    </div>
  )
}
