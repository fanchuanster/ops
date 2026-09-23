'use client'

import { type ReactNode, useActionState, useState } from 'react'

import {
  saveBookDetails,
  submitDraft,
  type DetailsState,
} from '../app/(frontend)/actions/bookDetails'
import { AutoFillButton } from './AutoFillButton'
import { describeBytes } from '../domain/kindle'
import {
  BOOK_LEVELS,
  DEFAULT_BOOK_LEVEL,
  LEVEL_LABELS,
  levelFromId,
} from '../domain/levels'
import { AI_PLAN_CHOICE, type PublicationPlan, type SourceKind } from '../domain/publication'
import { DEFAULT_VISIBILITY, type Visibility } from '../domain/moderation'
import { FIRST_ORDER_ID, MAX_ORDER_ID } from '../domain/shelfOrder'
import { type BookSource } from '../domain/sources'

const FORM_ID = 'book-details'

const UNSURE = 'Couldn’t find this — please check'

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
  proposedLevel: number | null
  canProposeLevel: boolean
  sourceKind: SourceKind
  plan: PublicationPlan
  aiCorrection: boolean
}

function badge(kind: SourceKind): string {
  return kind === 'text' ? 'txt' : kind
}

function Hint({ unsure, children }: { unsure?: boolean; children: ReactNode }) {
  return <small className={unsure ? 'field-hint field-hint--unsure' : 'field-hint'}>{children}</small>
}

function Guessed({
  draft,
  value,
  guess,
}: {
  draft: boolean
  value: string
  guess: string
}) {
  if (!draft) return null
  return value ? <Hint>{guess}</Hint> : <Hint unsure>{UNSURE}</Hint>
}

function pagesLabel(book: EditableBook): string | null {
  if (book.pageCount === null) return null
  return book.pagesAreEstimated ? `about ${book.pageCount} pages` : `${book.pageCount} pages`
}

export function BookDetailsForm({
  book,
  sources,
  collections,
  cover,
  needsFirstPage = false,
  draft = false,
  byAdmin = false,
}: {
  book: EditableBook
  sources: BookSource[]
  collections: { id: number; title: string; depth: number }[]
  cover?: ReactNode
  needsFirstPage?: boolean
  draft?: boolean
  byAdmin?: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(
    draft ? submitDraft : saveBookDetails,
    {},
  )

  const [shelf, setShelf] = useState<number | null>(book.collection)
  const [filledShelf, setFilledShelf] = useState<number | null>(book.collection)
  if (book.collection !== filledShelf) {
    setFilledShelf(book.collection)
    setShelf(book.collection)
  }
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY)
  const offered = draft && visibility === 'public'

  const pages = pagesLabel(book)

  return (
    <div className="upload-form review-card">
      {sources.length > 0 ? (
        <section className="review-card__files">
          <span className="field-label">Uploaded files</span>
          <ul>
            {sources.map((source) => (
              <li key={source.kind}>
                <span className={`fmt fmt--${badge(source.kind)}`}>{badge(source.kind)}</span>
                <span className="review-card__filename">{source.filename || 'your file'}</span>
                {source.bytes ? <small>{describeBytes(source.bytes)}</small> : null}
                {source.kind === book.sourceKind && pages ? <small>{pages}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        key={[book.title, book.author, book.language, book.collection].join('|')}
        id={FORM_ID}
        action={action}
        className="review-card__form"
      >
        <input type="hidden" name="bookId" value={book.id} />
        {draft ? null : (
          <input
            type="hidden"
            name="planChoice"
            value={book.aiCorrection ? AI_PLAN_CHOICE : book.plan}
          />
        )}

        <div className="review-card__details-head">
          <span className="field-label">Details</span>
          <AutoFillButton bookId={book.id} needsFirstPage={needsFirstPage} />
        </div>

        <div className="review-card__grid">
          <label>
            <span className="field-label">Title</span>
            <input
              type="text"
              name="title"
              defaultValue={book.title}
              required
              maxLength={200}
              data-unsure={draft && !book.title}
            />
            <Guessed draft={draft} value={book.title} guess="Read from the file names and first page" />
          </label>

          <label>
            <span className="field-label">Author</span>
            <input
              type="text"
              name="author"
              defaultValue={book.author}
              maxLength={200}
              data-unsure={draft && !book.author}
            />
            <Guessed draft={draft} value={book.author} guess="Read from the file names and first page" />
          </label>

          <label>
            <span className="field-label">Language</span>
            <select name="language" defaultValue={book.language} data-unsure={draft && !book.language}>
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Guessed draft={draft} value={book.language} guess="Read from the file names and first page" />
          </label>

          <label>
            <span className="field-label">Collection</span>
            <select
              name="collection"
              value={shelf === null ? '' : String(shelf)}
              onChange={(event) =>
                setShelf(event.currentTarget.value ? Number(event.currentTarget.value) : null)
              }
            >
              <option value="">Uncategorized</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {`${'\u00a0\u00a0\u00a0'.repeat(collection.depth - 1)}${collection.title}`}
                </option>
              ))}
            </select>
            <Hint>
              {draft && book.collection !== null
                ? 'Suggested from the file names and first page'
                : 'Only used if the book is ever published'}
            </Hint>
          </label>

          {book.canProposeLevel ? (
            <label>
              <span className="field-label">Importance level</span>
              <select
                name="proposedLevel"
                defaultValue={book.proposedLevel ? levelFromId(book.proposedLevel) : DEFAULT_BOOK_LEVEL}
              >
                {BOOK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
              <Hint>
                {byAdmin
                  ? 'How much of the collection a reader needs'
                  : 'Your suggestion — an editor decides'}
              </Hint>
            </label>
          ) : null}

          {draft ? (
            <label>
              <span className="field-label">Visibility</span>
              <select
                name="visibility"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.currentTarget.value === 'private' ? 'private' : 'public')
                }
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <Hint>Private books stay off the public library</Hint>
            </label>
          ) : null}

          {byAdmin ? (
            <label>
              <span className="field-label">Order number</span>
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
              <Hint>
                {shelf === null
                  ? 'A book has a place only once it is on a shelf'
                  : 'Position within the collection, lowest first'}
              </Hint>
            </label>
          ) : null}
        </div>

      </form>

      {cover ? (
        <section className="review-card__cover">
          <span className="field-label">Cover image</span>
          {cover}
        </section>
      ) : null}

      <div className="review-card__footer">
        {offered && !byAdmin ? (
          <p className="hint review-card__terms">
            Reviewed by an editor before it joins the public library.
          </p>
        ) : draft && !offered ? (
          <p className="hint review-card__terms">
            Private books skip review. You can offer it to the library later.
          </p>
        ) : (
          <span />
        )}
        <div className="review-card__actions">
          {byAdmin && offered ? <span className="review-card__badge">Admin</span> : null}
          <a href="/account/books" className="button-quiet">
            Cancel
          </a>
          <button
            type="submit"
            form={FORM_ID}
            className="cta cta--compact"
            disabled={pending}
          >
            {pending
              ? draft
                ? offered && byAdmin
                  ? 'Publishing…'
                  : 'Submitting…'
                : 'Saving…'
              : !draft
                ? 'Save details'
                : !offered
                  ? 'Submit'
                  : byAdmin
                    ? 'Publish'
                    : 'Submit for review'}
          </button>
        </div>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </div>
  )
}
