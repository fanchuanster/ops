'use client'

import { useActionState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { type PublicationPlan, type SourceKind, plansFor } from '../domain/publication'
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
 * page. Submitting for review is offered later, on the finished book,
 * when there is something to judge.
 *
 * The one decision that does belong here is what to *do* with the file,
 * and only a PDF has one to make: a scan has to be read before it can
 * reflow, which costs money and time and can go wrong, while a
 * born-digital PDF may already be perfectly good as it stands. A DOCX,
 * an EPUB and a text file each have exactly one sensible path, so they
 * are shown what will happen rather than asked to choose it
 * (`domain/publication.ts`).
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
  sourceKind: SourceKind
  plan: PublicationPlan
}

/** What each plan actually does, in the uploader's terms. */
const PLAN_COPY: Record<PublicationPlan, { label: string; detail: string }> = {
  convert: {
    label: 'Make an e-reader edition',
    detail:
      'The pages are read, and you get a reflowable EPUB you can resize and send to a Kindle, plus an editable master you can correct. Takes minutes to hours.',
  },
  as_is: {
    label: 'Publish it as it is',
    detail:
      'The file is published exactly as you uploaded it. Nothing is converted, so it stays fixed-layout and cannot reflow — good for a book that already reads well.',
  },
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

  // One option is not a choice. A DOCX, an EPUB and a text file each
  // have a single path, so the uploader is told what will happen rather
  // than asked to pick it out of a list of one.
  const plans = plansFor(book.sourceKind)

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

      {plans.length > 1 ? (
        <fieldset className="upload-form__collections">
          <legend>What should we do with it?</legend>
          <div>
            {plans.map((plan) => (
              <label key={plan} className="upload-form__check">
                <input type="radio" name="plan" value={plan} defaultChecked={plan === book.plan} />
                <span>
                  {PLAN_COPY[plan].label}
                  <small style={{ display: 'block' }}>{PLAN_COPY[plan].detail}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="notice">{PLAN_COPY[plans[0]!].detail}</p>
      )}

      <div className="upload-form__actions">
        <button type="submit" className="button-quiet" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
