'use client'

import { useActionState, useState } from 'react'

import { saveBookDetails, type LibraryState } from '../../app/(admin)/actions/library'
import { BOOK_LEVELS, LEVEL_DESCRIPTIONS, LEVEL_LABELS, type BookLevel } from '../../domain/levels'

/**
 * The panel beside the Books list, where a book is actually edited.
 *
 * The design's right-hand panel, adopted as drawn: title, original
 * title, description, shelf and level, with an explicit Save and a
 * Discard that appears only once something has changed.
 *
 * Author is here and is not in the design, which shows it read-only in
 * the panel header. A list that displays an author and cannot fix a
 * wrong one sends the editor to the CMS for a typo, which is exactly
 * the trip this panel exists to save.
 *
 * Which book is open is a `?book=` in the URL and not state in here —
 * the list is server-rendered, a row is a real link, and an editor can
 * send somebody the book they are looking at. What *is* state is the
 * unsaved draft, because that is what Discard restores and what makes
 * Save able to know whether it has anything to do.
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
  slug: string
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

  const dirty = (Object.keys(book) as (keyof BookEditValues)[]).some(
    (key) => draft[key] !== book[key],
  )

  const face = Array.from((book.originalTitle || book.title).trim())[0] ?? '·'

  return (
    <aside className="admin-panel">
      <header className="admin-panel__head">
        <div className="admin-bookcell">
          <span className="admin-face cjk" aria-hidden="true">
            {face}
          </span>
          <span>
            <h2>{book.title}</h2>
            {book.author ? <p className="admin-panel__author">{book.author}</p> : null}
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
            <option value="">No collection</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.title}
              </option>
            ))}
          </select>
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
    </aside>
  )
}
