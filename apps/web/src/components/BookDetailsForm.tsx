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
 * Two submits, one form. The difference is only whether the reader is
 * asking for the book to go into the public library; both convert it.
 * The private option is first and unqualified, because keeping your own
 * book to yourself is the normal case, not the lesser one.
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
  originalTitle: string
  author: string
  translator: string
  description: string
  language: string
  rightsStatus: string
  collections: number[]
}

export function BookDetailsForm({
  book,
  collections,
}: {
  book: EditableBook
  collections: { id: number; title: string }[]
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
        <span>Title in the original script</span>
        <input
          type="text"
          name="originalTitle"
          defaultValue={book.originalTitle}
          maxLength={200}
        />
        <small>For example 道德經. Leave empty if it is the same as the title.</small>
      </label>

      <label>
        <span>Author</span>
        <input type="text" name="author" defaultValue={book.author} maxLength={200} />
      </label>

      <label>
        <span>Translator</span>
        <input type="text" name="translator" defaultValue={book.translator} maxLength={200} />
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
        <span>Description</span>
        <textarea name="description" defaultValue={book.description} rows={4} maxLength={2000} />
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
          The one thing your file cannot tell us. Owning a copy keeps the book private to you,
          which is the normal case and perfectly fine — it is only needed if you want the book
          considered for the public library.
        </small>
      </label>

      {collections.length > 0 ? (
        <fieldset className="upload-form__collections">
          <legend>Collections</legend>
          <small>Where this book belongs, if it is ever published.</small>
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
        <button type="submit" name="intent" value="convert" className="button-quiet" disabled={pending}>
          {pending ? 'Saving…' : 'Convert and keep private'}
        </button>
        <button type="submit" name="intent" value="submit" className="button-quiet" disabled={pending}>
          Convert and submit for review
        </button>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
