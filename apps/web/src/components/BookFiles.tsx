'use client'

import { useActionState } from 'react'

import { replaceMaster, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { canBuildEpub, type SourceKind } from '../domain/publication'

export function BookFiles({
  bookId,
  slug,
  sourceKind,
  hasMaster,
  hasEpub,
}: {
  bookId: number
  slug: string
  sourceKind: SourceKind
  hasMaster: boolean
  hasEpub: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(replaceMaster, {})

  return (
    <section className="master">
      <h3>Files</h3>

      <ul className="files">
        <li className="files__row">
          <span className="fmt fmt--docx">docx</span>
          <span className="files__what">Master copy</span>
          {hasMaster ? (
            <a href={`/account/books/${bookId}/master`}>Download</a>
          ) : (
            <span className="files__state">Not converted yet</span>
          )}
        </li>

        {canBuildEpub(sourceKind) ? (
          <li className="files__row">
            <span className="fmt fmt--epub">epub</span>
            <span className="files__what">Reader edition</span>
            {hasEpub ? (
              <a href={`/read/${slug}`}>Read it</a>
            ) : (
              <span className="files__state">Not generated yet</span>
            )}
          </li>
        ) : null}
      </ul>

      {hasMaster ? (
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
              The EPUB and PDFs are rebuilt from it. The pages are not read again, so this is
              quick and does not count against your monthly limit.
            </small>
          </label>
          <button type="submit" className="button-quiet" disabled={pending}>
            {pending ? 'Uploading…' : 'Replace and rebuild'}
          </button>
          {state.error ? <p className="form-error">{state.error}</p> : null}
        </form>
      ) : null}
    </section>
  )
}
