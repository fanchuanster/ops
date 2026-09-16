'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import {
  deleteLibraryBook,
  saveBookDetails,
  type LibraryState,
} from '../../app/(admin)/actions/library'
import { BOOK_LEVELS, LEVEL_DESCRIPTIONS, LEVEL_LABELS, type BookLevel } from '../../domain/levels'
import { BookCoverControl } from './BookCoverControl'
import { useOnSaved } from './useOnSaved'

export interface BookEditValues {
  id: number
  title: string
  originalTitle: string
  author: string
  description: string
  level: BookLevel
  collectionId: number | null
  collectionOrder: number | null
  slug: string
  published: boolean
  sent: number
  uploader: string | null
  uploaderEmail: string | null
  uploaded: string
  coverUrl: string | null
  hasUploadedCover: boolean
  coverPage: number
  coverPages: number[]
  hasRenderedCover: boolean
  canMakeCover: boolean
}

export function BookEditPanel({
  book,
  collections,
  closeHref,
}: {
  book: BookEditValues
  collections: { id: number; title: string }[]
  closeHref: string
}) {
  const [state, save, saving] = useActionState<LibraryState, FormData>(saveBookDetails, {})
  const [removeState, remove, removing] = useActionState<LibraryState, FormData>(
    deleteLibraryBook,
    {},
  )
  const router = useRouter()

  useOnSaved(state, () => router.replace(closeHref, { scroll: false }))

  const [draft, setDraft] = useState<BookEditValues>(book)
  const [openedAs, setOpenedAs] = useState(book)
  if (openedAs.id !== book.id) {
    setOpenedAs(book)
    setDraft(book)
  }

  const set = <K extends keyof BookEditValues>(key: K, value: BookEditValues[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const EDITED = [
    'title',
    'originalTitle',
    'author',
    'description',
    'level',
    'collectionId',
    'collectionOrder',
  ] as const
  const dirty = EDITED.some((key) => draft[key] !== book[key])

  const face = Array.from((book.originalTitle || book.title).trim())[0] ?? '·'

  return (
    <aside className="admin-panel">
      <header className="admin-panel__head">
        <div className="admin-bookcell">
          <BookCoverControl
            bookId={book.id}
            coverUrl={book.coverUrl}
            hasUploadedCover={book.hasUploadedCover}
            canMakeCover={book.canMakeCover}
            coverPage={book.coverPage}
            coverPages={book.coverPages}
            hasRendered={book.hasRenderedCover}
            face={face}
          />
          <span>
            <h2>{book.title}</h2>
            <p className="admin-panel__meta">
              <span
                className={`admin-chip-status admin-chip-status--${book.published ? 'approved' : 'unsubmitted'}`}
              >
                {book.published ? 'Published' : 'Draft'}
              </span>
              <span className="admin-quiet">
                {book.sent} sent
              </span>
            </p>
            <p className="admin-panel__meta admin-quiet">
              {book.uploader
                ? `Uploaded by ${book.uploader}`
                : 'Entered by staff — no uploader'}
              {book.uploaded ? ` · ${book.uploaded}` : null}
            </p>
            {book.uploaderEmail ? (
              <p className="admin-panel__meta admin-quiet">{book.uploaderEmail}</p>
            ) : null}
          </span>
        </div>
        <Link className="admin-panel__close" href={closeHref} scroll={false} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </header>

      <form action={save} className="admin-panel__body admin-fields">
        <input type="hidden" name="bookId" value={book.id} />
        <input type="hidden" name="slug" value={book.slug} />

        <div className="admin-field">
          <label htmlFor="book-title">Title</label>
          <input
            id="book-title"
            name="title"
            value={draft.title}
            required
            onChange={(event) => set('title', event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="book-original">Original title</label>
          <input
            id="book-original"
            name="originalTitle"
            className="cjk"
            placeholder="道德經"
            value={draft.originalTitle}
            onChange={(event) => set('originalTitle', event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="book-author">Author</label>
          <input
            id="book-author"
            name="author"
            value={draft.author}
            onChange={(event) => set('author', event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="book-description">Description</label>
          <textarea
            id="book-description"
            name="description"
            rows={4}
            placeholder="What a reader is told this book is. Shown on its page."
            value={draft.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="book-collection">Collection</label>
          <select
            id="book-collection"
            name="collectionId"
            value={draft.collectionId === null ? '' : String(draft.collectionId)}
            onChange={(event) =>
              set('collectionId', event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">Other</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.title}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="book-order">Order on shelf</label>
          <input
            id="book-order"
            name="collectionOrder"
            className="admin-num"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={draft.collectionOrder === null ? '' : String(draft.collectionOrder)}
            onChange={(event) =>
              set(
                'collectionOrder',
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
            disabled={draft.collectionId === null}
          />
          <p className="admin-quiet">
            {draft.collectionId === null
              ? 'A book has a place only once it is on a shelf.'
              : 'Where readers meet it on this shelf, lowest first. A number another book has is fine — they read alphabetically between themselves, and nothing else moves.'}
          </p>
        </div>

        <fieldset className="admin-field admin-field--level">
          <legend>Level</legend>
          {BOOK_LEVELS.map((option) => (
            <label key={option} className="admin-levelchoice" data-on={draft.level === option}>
              <input
                type="radio"
                name="level"
                value={option}
                checked={draft.level === option}
                onChange={() => set('level', option)}
              />
              <span>{LEVEL_LABELS[option]}</span>
              <em>{LEVEL_DESCRIPTIONS[option]}</em>
            </label>
          ))}
        </fieldset>

        <div className="admin-panel__actions">
          <button type="submit" className="admin-btn admin-btn--publish" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty ? (
            <button
              type="button"
              className="admin-linkbtn"
              onClick={() => setDraft(book)}
              disabled={saving}
            >
              Discard
            </button>
          ) : null}
        </div>

        {state.error ? <p className="form-error">{state.error}</p> : null}
        {state.ok && !state.error && !dirty ? <p className="admin-ok">{state.ok}</p> : null}
      </form>

      <form action={remove} className="admin-panel__danger">
        <input type="hidden" name="bookId" value={book.id} />
        <button
          type="submit"
          className="admin-linkbtn admin-linkbtn--danger"
          disabled={removing}
          onClick={(event) => {
            const confirmed = window.confirm(
              `Delete “${book.title}”?\n\n` +
                'This removes the uploaded file, the DOCX master, every format made ' +
                'from it and the cover. It cannot be undone.',
            )
            if (!confirmed) event.preventDefault()
          }}
        >
          {removing ? 'Deleting…' : 'Delete this book'}
        </button>
        {removeState.error ? <p className="form-error">{removeState.error}</p> : null}
      </form>
    </aside>
  )
}
