'use client'

import { useActionState } from 'react'

import { replaceMaster, type DetailsState } from '../app/(frontend)/actions/bookDetails'

/**
 * Downloading and replacing a draft's DOCX master.
 *
 * The master is normally not a reader download at all — it is the
 * source of truth every other format is generated from. Its owner is
 * the exception, and the reason is the whole point of a draft: a
 * conversion from a scan is a first pass, and the person who uploaded
 * the book is the one who can see what the OCR misread.
 */
export function MasterFile({ bookId, hasMaster }: { bookId: number; hasMaster: boolean }) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(replaceMaster, {})

  return (
    <section className="master">
      <h3>The master file</h3>

      {hasMaster ? (
        <p>
          <a href={`/account/books/${bookId}/master`} className="master__download">
            Download the DOCX master
          </a>
          <span className="hint">
            {' '}
            Everything else — the EPUB, the PDFs — is generated from this file, so correcting it
            here is how a mistake gets fixed everywhere.
          </span>
        </p>
      ) : (
        <p className="hint">
          There is no master yet. It appears once the book has been through conversion.
        </p>
      )}

      <form action={action} className="master__replace">
        <input type="hidden" name="bookId" value={bookId} />
        <label>
          <span>Upload a corrected master</span>
          <input
            type="file"
            name="master"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
          />
          <small>
            The book is rebuilt from it. This does not use another of your monthly conversions —
            correcting a book you already uploaded is not a new book.
          </small>
        </label>
        <button type="submit" className="button-quiet" disabled={pending}>
          {pending ? 'Uploading…' : 'Replace and rebuild'}
        </button>
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    </section>
  )
}
