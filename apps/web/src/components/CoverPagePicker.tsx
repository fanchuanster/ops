'use client'

import { useActionState } from 'react'

import { chooseCoverPage, type CoverPageState } from '../app/(frontend)/actions/cover'
import { coverPageUrl } from '../domain/cover'

/**
 * Which page of the book its cover is taken from.
 *
 * A row of the opening pages, as they actually look, with the one in
 * use marked. Thumbnails rather than a list of page numbers because the
 * question — is this the cover, or is the cover a leaf further in? — is
 * one nobody can answer from a number, and the pages are already
 * rendered and sitting in the bucket.
 *
 * Each page is its own submit button in its own form, so this works
 * with the keyboard and needs nothing clever: the whole interaction is
 * one POST that changes one number.
 *
 * Shown only where there is a choice. A book with one candidate — an
 * EPUB, or anything rendered before candidates existed — gets no picker
 * at all rather than a row of one, which would be a control that cannot
 * do anything.
 */
export function CoverPagePicker({
  bookId,
  page,
  pages,
  className = '',
}: {
  bookId: number
  /** The page in use. */
  page: number
  /** Every page that was rendered, in order. */
  pages: number[]
  className?: string
}) {
  const [state, choose, choosing] = useActionState<CoverPageState, FormData>(chooseCoverPage, {})

  if (pages.length < 2) return null

  return (
    <div className={`coverpick ${className}`.trim()}>
      <p className="coverpick__label" id={`coverpick-${bookId}`}>
        Cover page
      </p>

      <ul className="coverpick__pages" aria-labelledby={`coverpick-${bookId}`}>
        {pages.map((candidate) => {
          const current = candidate === page
          return (
            <li key={candidate}>
              <form action={choose}>
                <input type="hidden" name="bookId" value={bookId} />
                <input type="hidden" name="page" value={candidate} />
                <button
                  type="submit"
                  className={`coverpick__page${current ? ' coverpick__page--on' : ''}`}
                  // Pressed rather than disabled: the page in use is
                  // still a legible thumbnail, and disabling it would
                  // take it out of the tab order that the others are in.
                  aria-pressed={current}
                  disabled={choosing}
                >
                  <img src={coverPageUrl(bookId, candidate)} alt="" loading="lazy" />
                  <span>{candidate === 1 ? 'Page 1' : `Page ${candidate}`}</span>
                </button>
              </form>
            </li>
          )
        })}
      </ul>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </div>
  )
}
