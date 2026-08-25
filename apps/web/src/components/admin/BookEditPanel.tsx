'use client'

import { useActionState, useState } from 'react'

import {
  deleteLibraryBook,
  saveBookDetails,
  type LibraryState,
} from '../../app/(admin)/actions/library'
import { BOOK_LEVELS, LEVEL_DESCRIPTIONS, LEVEL_LABELS, type BookLevel } from '../../domain/levels'
import { BookCoverControl } from './BookCoverControl'

/**
 * The panel beside the Books list, where a book is actually edited.
 *
 * The design's right-hand panel, adopted as drawn: title, original
 * title, author, description, shelf and level, with an explicit Save
 * and a Discard that appears only once something has changed.
 *
 * One field the design does not draw: where the book sits on its shelf.
 * A book is given that number when it is filed and it is what a reader
 * browsing in the curated order is sorted by (`domain/shelfOrder.ts`),
 * so without a box for it the order could only ever be the order the
 * books happened to arrive in.
 *
 * Since the Books and Collections screens merged this is also the only
 * place a single book's level is set — the row shows it as a label
 * now, and the shelf form beside it sets a whole subtree at once.
 *
 * Which book is open is a `?book=` in the URL and not state in here —
 * the tree is server-rendered, a row is a real link, and an editor can
 * send somebody the book they are looking at. What *is* state is the
 * unsaved draft, because that is what Discard restores and what makes
 * Save able to know whether it has anything to do.
 *
 * The cover is here too, as the panel's own face rather than as a
 * field in the form. It was editable only in the CMS until 2026-08-24,
 * which made it the one property of a book that could not be changed on
 * the screen for changing books. It saves on choosing a file rather
 * than on Save — see `BookCoverControl`.
 *
 * Deleting is here and is deliberately at the bottom, outside the
 * form: it is not a field, it cannot be part of Save, and a `<form>`
 * inside a `<form>` is not valid HTML. The server decides whether it is
 * allowed (`deleteLibraryBook`) — the confirmation is courtesy.
 *
 * Deliberately absent: rights status, visibility, ownership, review.
 * Visibility in particular is no longer a field anybody sets — a book
 * is in the library because it was approved (`actions/review.ts`), and
 * a second control that could contradict that would only be a way to
 * publish something the rights never cleared.
 */

export interface BookEditValues {
  id: number
  title: string
  originalTitle: string
  author: string
  description: string
  level: BookLevel
  collectionId: number | null
  /**
   * Where it sits among the books on that shelf, lowest first.
   *
   * Null for a book on no shelf, and for one nobody has numbered — the
   * box is empty in both cases, and leaving it empty changes nothing.
   */
  collectionOrder: number | null
  slug: string
  /** In the public library — which since 2026-08-24 means "approved". */
  published: boolean
  /** Deliveries to e-readers. Not downloads; NobleSee has none. */
  sent: number
  /** Who uploaded it, or null for a book staff entered. */
  uploader: string | null
  /** Their email, when the name above was not already it. */
  uploaderEmail: string | null
  /** The day it arrived, ISO, formatted on the server. */
  uploaded: string
  /** What a reader sees: the upload, else page one, else neither. */
  coverUrl: string | null
  /** Whether that picture is an editor's upload, so removable. */
  hasUploadedCover: boolean
  /** Which rendered page the book wears, and what else was rendered. */
  coverPage: number
  coverPages: number[]
  /** Whether any page of the book has been rasterized yet. */
  hasRenderedCover: boolean
  /** Whether a browser could render pages for it from an artifact. */
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

  // Keyed by the book's id so opening a different row resets the draft
  // rather than carrying the last one's half-typed title across.
  const [draft, setDraft] = useState<BookEditValues>(book)
  const [openedAs, setOpenedAs] = useState(book)
  if (openedAs.id !== book.id) {
    setOpenedAs(book)
    setDraft(book)
  }

  const set = <K extends keyof BookEditValues>(key: K, value: BookEditValues[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  // The cover is not part of the draft: it saves on its own, the moment
  // a file is chosen, so comparing it here would leave Save enabled
  // after an upload with nothing for it to write.
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
            {/* Where the book came from. Below the chips rather than
                beside them, because it is a sentence and they are
                labels — and it is the answer to the question the
                Library screen's own column raises. */}
            <p className="admin-panel__meta admin-quiet">
              {book.uploader
                ? `Uploaded by ${book.uploader}`
                : 'Entered by staff — no uploader'}
              {book.uploaded ? ` · ${book.uploaded}` : null}
            </p>
            {/* The email only when the name shown above was something
                else — repeating it under itself says nothing. */}
            {book.uploaderEmail ? (
              <p className="admin-panel__meta admin-quiet">{book.uploaderEmail}</p>
            ) : null}
          </span>
        </div>
        <a className="admin-panel__close" href={closeHref} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
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
            {/* "Other", not "No collection": a book here is filed
                somewhere an editor can find it, rather than sitting in
                a hole in the library. The tree calls the same group the
                same thing. */}
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
          {/* Two sentences because two things are non-obvious: that a
              taken number shifts rather than collides, and that this is
              a position on one shelf rather than in the library. The
              box is disabled under "Other" — a book on no shelf has
              nothing to be third of. */}
          <p className="admin-quiet">
            {draft.collectionId === null
              ? 'A book has a place only once it is on a shelf.'
              : 'Where readers meet it on this shelf. A number another book has shifts that book down.'}
          </p>
        </div>

        <fieldset className="admin-field admin-field--level">
          <legend>Level</legend>
          {/* Radios rather than buttons: three mutually exclusive
              choices that are saved together with everything else, so
              they must be form state and not their own submit. */}
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
                'from it and the cover. It cannot be undone.\n\n' +
                'A book readers have spent credits on cannot be deleted at all.',
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
