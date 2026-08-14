'use client'

import { useActionState } from 'react'

import {
  deleteBook,
  retryConversion,
  type ManageState,
} from '../app/(frontend)/actions/manageBook'

/**
 * Managing one uploaded book: retrying a failed conversion, deleting it.
 *
 * Delete asks first. It destroys the source file and every generated
 * format, and unlike almost everything else here it cannot be undone —
 * a confirmation is the least that owes the reader. The server checks
 * ownership and the entitlement rule again regardless; this dialog is
 * courtesy, not a control.
 */
export function BookActions({
  bookId,
  title,
  canRetry,
}: {
  bookId: number
  title: string
  canRetry: boolean
}) {
  const [removeState, remove, removing] = useActionState<ManageState, FormData>(deleteBook, {})
  const [retryState, retry, retrying] = useActionState<ManageState, FormData>(
    retryConversion,
    {},
  )

  return (
    <section className="book-manage">
      <h3>Manage this book</h3>

      <div className="book-manage__actions">
        {canRetry ? (
          <form action={retry}>
            <input type="hidden" name="bookId" value={bookId} />
            <button type="submit" className="button-quiet" disabled={retrying}>
              {retrying ? 'Queueing…' : 'Try converting again'}
            </button>
          </form>
        ) : null}

        <form action={remove}>
          <input type="hidden" name="bookId" value={bookId} />
          <button
            type="submit"
            className="button-quiet button-quiet--danger"
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
            {removing ? 'Deleting…' : 'Delete this book'}
          </button>
        </form>
      </div>

      {retryState.error ? <p className="form-error">{retryState.error}</p> : null}
      {removeState.error ? <p className="form-error">{removeState.error}</p> : null}
    </section>
  )
}
