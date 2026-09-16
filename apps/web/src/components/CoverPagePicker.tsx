'use client'

import { useActionState } from 'react'

import { chooseCoverPage, type CoverPageState } from '../app/(frontend)/actions/cover'
import { coverPageUrl } from '../domain/cover'

export function CoverPagePicker({
  bookId,
  page,
  pages,
  className = '',
}: {
  bookId: number
  page: number
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
