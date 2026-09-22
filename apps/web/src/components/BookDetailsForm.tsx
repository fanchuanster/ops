'use client'

import { type CSSProperties, useActionState, useState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { AI_PLAN_CHOICE, type PublicationPlan, type SourceKind } from '../domain/publication'
import { FIRST_ORDER_ID, MAX_ORDER_ID } from '../domain/shelfOrder'

const LANGUAGES = [
  { value: '', label: 'Not sure' },
  { value: 'zh-Hans', label: 'Simplified Chinese' },
  { value: 'zh-Hant', label: 'Traditional Chinese' },
  { value: 'en', label: 'English' },
  { value: 'zh-en', label: 'Chinese / English' },
]

export interface EditableBook {
  id: number
  title: string
  author: string
  language: string
  pageCount: number | null
  pagesAreEstimated: boolean
  collection: number | null
  collectionOrder: number | null
  sourceKind: SourceKind
  plan: PublicationPlan
  aiCorrection: boolean
}

function ReadFromFile({ show }: { show: boolean }) {
  return show ? <span className="field-mark">guessed</span> : null
}

export function BookDetailsForm({
  book,
  collections,
  draft = false,
  canOrderShelf = false,
}: {
  book: EditableBook
  collections: { id: number; title: string; depth: number }[]
  draft?: boolean
  canOrderShelf?: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveBookDetails, {})

  const [shelf, setShelf] = useState<number | null>(book.collection)

  return (
    <form action={action} className="upload-form">
      <input type="hidden" name="bookId" value={book.id} />
      <input
        type="hidden"
        name="planChoice"
        value={book.aiCorrection ? AI_PLAN_CHOICE : book.plan}
      />

      <div className="upload-form__grid">
        <label>
          <span className="field-label">
            Title
            <ReadFromFile show={draft && Boolean(book.title)} />
          </span>
          <input type="text" name="title" defaultValue={book.title} required maxLength={200} />
        </label>

        <label>
          <span className="field-label">
            Author
            <ReadFromFile show={draft && Boolean(book.author)} />
          </span>
          <input type="text" name="author" defaultValue={book.author} maxLength={200} />
        </label>

        <label>
          <span className="field-label">
            Language
            <ReadFromFile show={draft && Boolean(book.language)} />
          </span>
          <select name="language" defaultValue={book.language}>
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="field-label">
            Page count
            <span className="field-mark field-mark--locked">read-only</span>
          </span>
          <input
            type="text"
            readOnly
            value={book.pageCount === null ? 'Not known yet' : `${book.pageCount} pages`}
          />
          {book.pagesAreEstimated ? (
            <small>Read from the file. The exact count replaces it once conversion finishes.</small>
          ) : null}
        </label>
      </div>

      {collections.length > 0 ? (
        <fieldset className="upload-form__collections">
          <legend>Collection</legend>
          <small>Only used if the book is ever published.</small>
          <div>
            <label className="upload-form__shelf upload-form__shelf--none">
              <input
                type="radio"
                name="collection"
                value=""
                checked={shelf === null}
                onChange={() => setShelf(null)}
              />
              <span>Other</span>
            </label>

            {collections.map((collection) => (
              <label
                key={collection.id}
                className={
                  collection.depth === 1
                    ? 'upload-form__shelf'
                    : 'upload-form__shelf upload-form__shelf--nested'
                }
                style={{ '--depth': collection.depth - 1 } as CSSProperties}
              >
                <input
                  type="radio"
                  name="collection"
                  value={collection.id}
                  checked={shelf === collection.id}
                  onChange={() => setShelf(collection.id)}
                />
                <span>{collection.title}</span>
              </label>
            ))}
          </div>

          {canOrderShelf ? (
            <label className="upload-form__order">
              <span className="field-label">Order on shelf</span>
              <input
                type="number"
                name="collectionOrder"
                min={FIRST_ORDER_ID}
                max={MAX_ORDER_ID}
                step={1}
                inputMode="numeric"
                defaultValue={book.collectionOrder === null ? '' : String(book.collectionOrder)}
                disabled={shelf === null}
              />
              <small>
                {shelf === null
                  ? 'A book has a place only once it is on a shelf.'
                  : 'Lowest first, on a shelf an editor has set to read in order. Two books may share a number and then read alphabetically between themselves; leave it empty to keep the place it has.'}
              </small>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      <div className="upload-form__actions">
        <button type="submit" className="cta" disabled={pending}>
          Save details
        </button>
      </div>

      {pending ? <p className="hint">Saving…</p> : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
