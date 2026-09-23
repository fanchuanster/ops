'use client'

import { useActionState } from 'react'

import { deleteBook, type ManageState } from '../app/(frontend)/actions/manageBook'

export function DeleteBookButton({ bookId, title }: { bookId: number; title: string }) {
  const [state, remove, removing] = useActionState<ManageState, FormData>(deleteBook, {})

  return (
    <form action={remove} className="delete-book">
      <input type="hidden" name="bookId" value={bookId} />
      <button
        type="submit"
        className="delete-book__button"
        aria-label={`Delete “${title}”`}
        title="Delete this book"
        disabled={removing}
        onClick={(event) => {
          const confirmed = window.confirm(
            `Delete “${title}”?\n\n` +
              'This removes the file you uploaded and every format made from it — ' +
              'the EPUB, the PDFs and the DOCX master. It cannot be undone.\n\n' +
              'Download the master first if you want to keep your corrections.',
          )
          if (!confirmed) event.preventDefault()
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
