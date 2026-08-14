'use client'

import { useActionState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { UPLOADER_RIGHTS } from '../domain/rights'

/**
 * The editable summary of an uploaded book.
 *
 * Pre-filled from what the file said about itself and entirely
 * editable, because file metadata is frequently wrong and the reader is
 * the one who can tell. Nothing here is authoritative until they say so.
 *
 * One button, deliberately. It briefly offered "convert privately" and
 * "convert and submit for review" side by side, which asked the reader
 * to decide about publication before they had seen a single converted
 * page. Converting is the only thing to do here; submitting for review
 * is offered later, on the finished book, when there is something to
 * judge.
 */

const LANGUAGES = [
  { value: '', label: 'Not sure' },
  { value: 'zh-Hant', label: 'Traditional Chinese' },
  { value: 'zh-Hans', label: 'Simplified Chinese' },
  { value: 'en', label: 'English' },
  { value: 'zh-en', label: 'Chinese / English' },
]

export interface EditableBook {
  id: number
  title: string
  author: string
  language: string
  rightsStatus: string
  collections: number[]
}

export function BookDetailsForm({
  book,
  collections,
  submitLabel = 'Convert this book',
}: {
  book: EditableBook
  collections: { id: number; title: string }[]
  /** "Convert" for a draft; "Save changes" once it has been converted. */
  submitLabel?: string
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveBookDetails, {})

  // `unknown` is the value an upload starts with, and it is not one of
  // the things a reader may choose — so it shows as nothing chosen,
  // which is what it means.
  const chosenRights = UPLOADER_RIGHTS.some((o) => o.value === book.rightsStatus)
    ? book.rightsStatus
    : ''

  return (
    <form action={action} className="upload-form">
      <input type="hidden" name="bookId" value={book.id} />

      <label>
        <span>Title</span>
        <input type="text" name="title" defaultValue={book.title} required maxLength={200} />
      </label>

      <label>
        <span>Author</span>
        <input type="text" name="author" defaultValue={book.author} maxLength={200} />
      </label>

      <label>
        <span>Language</span>
        <select name="language" defaultValue={book.language}>
          {LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Where did this come from?</span>
        <select name="rightsStatus" defaultValue={chosenRights}>
          <option value="">Not answered yet</option>
          {UPLOADER_RIGHTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>
          The one thing your file cannot tell us. Only needed if you later want the book in the
          public library.
        </small>
      </label>

      {collections.length > 0 ? (
        <fieldset className="upload-form__collections">
          <legend>Collections</legend>
          <small>Only used if the book is ever published.</small>
          <div>
            {collections.map((collection) => (
              <label key={collection.id} className="upload-form__check">
                <input
                  type="checkbox"
                  name="collections"
                  value={collection.id}
                  defaultChecked={book.collections.includes(collection.id)}
                />
                <span>{collection.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="upload-form__actions">
        <button type="submit" className="button-quiet" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
