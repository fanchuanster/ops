'use client'

import { type CSSProperties, useActionState, useState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import {
  AI_PLAN_CHOICE,
  type PublicationPlan,
  type SourceKind,
  plansFor,
} from '../domain/publication'
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
}

const AI_NOTE =
  'Sends your book\u2019s text to xAI, outside NobleSee. A person reviews every suggestion.'

const PLAN_COPY: Record<
  SourceKind,
  Partial<Record<PublicationPlan, { label: string; sends?: string }>>
> = {
  pdf: {
    as_is: { label: 'Submit PDF for Review' },
    convert: {
      label: 'Convert & Generate',
      sends:
        'Converting sends your PDF to Adobe PDF Services, outside NobleSee, to have its pages read.',
    },
  },
  text: {
    as_is: { label: 'Submit text for Review' },
    convert: { label: 'Convert & Generate' },
  },
  docx: {
    convert: { label: 'Convert & Generate' },
  },
  epub: {
    as_is: { label: 'Publish as it is' },
  },
}

function planCopy(kind: SourceKind, plan: PublicationPlan) {
  return PLAN_COPY[kind][plan] ?? PLAN_COPY.pdf[plan]!
}

function ConvertButton({
  label,
  primary,
  pending,
}: {
  label: string
  primary: boolean
  pending: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className={primary ? 'split-button' : 'split-button split-button--quiet'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="submit"
        name="planChoice"
        value="convert"
        className={primary ? 'cta' : 'cta cta--quiet'}
        disabled={pending}
      >
        {label}
      </button>
      <button
        type="button"
        className="split-button__toggle"
        aria-label="More conversion options"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>

      {open ? (
        <div className="split-button__menu">
          <button
            type="submit"
            name="planChoice"
            value={AI_PLAN_CHOICE}
            className="split-button__item"
            disabled={pending}
          >
            Use AI to suggest corrections
          </button>
          <span className="split-button__note">{AI_NOTE}</span>
        </div>
      ) : null}
    </div>
  )
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

  const plans = plansFor(book.sourceKind)

  const [shelf, setShelf] = useState<number | null>(book.collection)

  return (
    <form action={action} className="upload-form">
      <input type="hidden" name="bookId" value={book.id} />

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
        {plans.map((option) =>
          option === 'convert' ? (
            <ConvertButton
              key={option}
              label={planCopy(book.sourceKind, option).label}
              primary={option === book.plan}
              pending={pending}
            />
          ) : (
            <button
              key={option}
              type="submit"
              name="planChoice"
              value={option}
              className={option === book.plan ? 'cta' : 'cta cta--quiet'}
              disabled={pending}
            >
              {planCopy(book.sourceKind, option).label}
            </button>
          ),
        )}
      </div>

      {plans
        .map((option) => planCopy(book.sourceKind, option).sends)
        .filter((sends): sends is string => Boolean(sends))
        .map((sends) => (
          <p key={sends} className="hint">
            {sends}
          </p>
        ))}

      {pending ? <p className="hint">Saving…</p> : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
