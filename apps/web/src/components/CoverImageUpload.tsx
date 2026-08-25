'use client'

import { useActionState, useRef } from 'react'

import { removeBookCover, saveBookCover, type CoverState } from '../app/(frontend)/actions/cover'

/**
 * Upload your own image as a book's cover.
 *
 * The owner's counterpart to the admin panel's `BookCoverControl`, over
 * the same two actions. Separate components rather than one shared one
 * because the two screens are different designs — an editor's dense
 * panel and a reader's own book page — and the only thing worth sharing
 * is the rule, which lives in the action and in `domain/cover.ts`.
 *
 * Why an owner may do this at all: a cover is not a claim about the
 * book, only which photograph of it looks right, and the person holding
 * the physical copy can photograph the jacket that no scan of the
 * inside pages contains.
 *
 * Submits on *choosing* a file rather than behind a Save. Picking an
 * image out of a file dialog is already a deliberate act, and a chosen
 * file sitting unsent beside a picture that has not changed is a worse
 * state than no preview at all.
 *
 * Remove is not a way to have no cover: it falls back to a page of the
 * book, which is what the page picker above it is choosing between.
 *
 * `private` is not a permission — an uploader may always do this — it
 * is a warning, and it is owed. A *generated* cover is streamed through
 * `/covers/<id>`, which asks the Books access rule first, so a private
 * upload's first page is its owner's alone. An uploaded image is a
 * Media document, and Media is `read: () => true` served from this
 * origin: anyone with the URL has it. The two covers are not equally
 * private and the person choosing between them should know it.
 */
export function CoverImageUpload({
  bookId,
  hasUploadedCover,
  bookIsPrivate,
}: {
  bookId: number
  /** Whether an image is currently overriding the book's own pages. */
  hasUploadedCover: boolean
  /** Whether the book itself is visible only to its owner. */
  bookIsPrivate: boolean
}) {
  const [saved, save, saving] = useActionState<CoverState, FormData>(saveBookCover, {})
  const [removed, remove, removing] = useActionState<CoverState, FormData>(removeBookCover, {})
  const form = useRef<HTMLFormElement>(null)

  const state = saved.error || saved.ok ? saved : removed
  const busy = saving || removing

  return (
    <div className="cover-upload">
      <form ref={form} action={save}>
        <input type="hidden" name="bookId" value={bookId} />

        {/* A label rather than a button driving a hidden input: the file
            dialog opens from the browser's own control, so it works
            with the keyboard and needs no JavaScript beyond the submit. */}
        <label className="cover-upload__btn button-quiet">
          <input
            type="file"
            name="cover"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy}
            onChange={(event) => {
              if (event.target.files?.length) form.current?.requestSubmit()
            }}
          />
          <span>
            {saving
              ? 'Uploading…'
              : hasUploadedCover
                ? 'Upload a different image'
                : 'Upload an image instead'}
          </span>
        </label>
      </form>

      {hasUploadedCover ? (
        <form action={remove}>
          <input type="hidden" name="bookId" value={bookId} />
          <button type="submit" className="button-quiet" disabled={busy}>
            {removing ? 'Removing…' : 'Remove it and use a page of the book'}
          </button>
        </form>
      ) : null}

      {bookIsPrivate ? (
        <p className="hint">
          Your book stays private, but an image you upload here is served from a public
          address — unlike a cover made from the book&rsquo;s own pages, which only you can
          see. Use a jacket photo rather than a page you would not publish.
        </p>
      ) : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.ok ? <p className="hint">{state.ok}</p> : null}
    </div>
  )
}
