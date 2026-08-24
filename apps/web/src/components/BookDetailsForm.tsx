'use client'

import { useActionState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { type PublicationPlan, type SourceKind, plansFor } from '../domain/publication'

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
 * when there is something to judge — and so is the rights question,
 * which used to be a select on this form. It moved for the same reason
 * the submit button did: it is only load-bearing at the moment someone
 * asks for the book to be published, and asking it here made a private
 * upload feel like a submission (`SubmitForReview`).
 *
 * Original title and translator were also deliberately absent until
 * 2026-08-21, on the argument that they are curatorial rather than
 * something an uploader confirming their own scan can answer. The Figma
 * revision put them back, and the argument does not survive the way
 * extraction actually works: for a Chinese classic the file's own
 * metadata usually *is* the original title — 道德經 — so the field
 * arrives pre-filled and the uploader is confirming, not composing. A
 * field they can leave alone is cheap; a wrong 道德經 nobody was shown
 * is not.
 *
 * The one decision that does belong here is what to *do* with the file,
 * and only a PDF has one to make: a scan has to be read before it can
 * reflow, which costs money and time and can go wrong, while a
 * born-digital PDF may already be perfectly good as it stands. A DOCX,
 * an EPUB and a text file each have exactly one sensible path, so they
 * are shown what will happen rather than asked to choose it
 * (`domain/publication.ts`).
 */

/**
 * Simplified Chinese leads the list and is what a book arrives with
 * when its file said nothing (the `language` default in
 * `collections/Books.ts`), because it is what most uploads are. The
 * order is the same one the admin select uses, so an uploader and an
 * editor are reading the same list.
 *
 * "Not sure" stays at the top as the empty value rather than being
 * ranked among the languages — it is the absence of an answer, and a
 * reader looking for it is looking for the way out of the question.
 */
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
  originalTitle: string
  author: string
  translator: string
  language: string
  /** Exact once converted, estimated before; null when neither is known. */
  pageCount: number | null
  pagesAreEstimated: boolean
  collections: number[]
  sourceKind: SourceKind
  plan: PublicationPlan
}

/** What each plan actually does, in the uploader's terms. */
const PLAN_COPY: Record<PublicationPlan, { tag: string; label: string; detail: string }> = {
  convert: {
    tag: 'Recommended',
    label: 'Convert & Generate',
    detail:
      'Pages are read and text is rebuilt to reflow — adjustable size, chapter navigation, readable on any device. Produces a typeset EPUB and PDF.',
  },
  as_is: {
    tag: 'Faster',
    label: 'Submit PDF for Review',
    detail:
      'Publish exactly what you uploaded. Perfect fidelity — but text won’t reflow, so it can’t adapt to a Kindle’s screen. Convert later if you change your mind.',
  },
}

/**
 * The badge on a field whose value came out of the file.
 *
 * "guessed", which is the design's word, rather than "from your file".
 * Both are true and the design's is the one that invites correction —
 * which is the entire purpose of this screen.
 *
 * Shown only while the book is a draft. After that everything on the
 * form is something the reader has already seen and accepted, and
 * marking it as guessed would be telling them about a decision they
 * made themselves.
 */
function ReadFromFile({ show }: { show: boolean }) {
  return show ? <span className="field-mark">guessed</span> : null
}

export function BookDetailsForm({
  book,
  collections,
  draft = false,
  submitLabel = 'Next',
}: {
  book: EditableBook
  /** In tree order, parents before their children; `depth` indents them. */
  collections: { id: number; title: string; depth: number }[]
  /** Before conversion, when the values on show were guessed. */
  draft?: boolean
  /** "Next" for a draft, which is a step in a flow; "Save changes" after. */
  submitLabel?: string
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveBookDetails, {})

  // One option is not a choice. A DOCX, an EPUB and a text file each
  // have a single path, so the uploader is told what will happen rather
  // than asked to pick it out of a list of one.
  const plans = plansFor(book.sourceKind)

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
          Original title
          <ReadFromFile show={draft && Boolean(book.originalTitle)} />
        </span>
        <input
          type="text"
          name="originalTitle"
          defaultValue={book.originalTitle}
          maxLength={200}
          lang="zh"
        />
        <small>The title in its own script, if the one above is a translation — 道德經.</small>
      </label>

      <label>
        <span className="field-label">
          Author
          <ReadFromFile show={draft && Boolean(book.author)} />
        </span>
        <input type="text" name="author" defaultValue={book.author} maxLength={200} />
      </label>

      <label>
        <span className="field-label">Translator</span>
        <input type="text" name="translator" defaultValue={book.translator} maxLength={200} />
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

      {/* Read-only, and not a disabled input: the length is a property
          of the file, counted rather than claimed. It is what the credit
          price and the monthly allowance are both computed from, so it
          is shown rather than hidden — but there is nothing to correct. */}
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
          <legend>Collections</legend>
          <small>Only used if the book is ever published.</small>
          <div>
            {collections.map((collection) => (
              <label
                key={collection.id}
                className="upload-form__check"
                // Collections nest, and a sub-shelf that reads as a peer
                // of the shelf above it is a different choice from the
                // one being offered.
                style={{ marginLeft: `${(collection.depth - 1) * 1.25}rem` }}
              >
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
        <fieldset className="plan-cards">
          <legend>What should we do with it?</legend>
          {plans.map((plan) => (
            <label key={plan} className="plan-card">
              <input type="radio" name="plan" value={plan} defaultChecked={plan === book.plan} />
              <span
                className={`plan-card__tag${
                  plan === 'convert' ? ' plan-card__tag--recommended' : ''
                }`}
              >
                {PLAN_COPY[plan].tag}
              </span>
              <strong>{PLAN_COPY[plan].label}</strong>
              <span>{PLAN_COPY[plan].detail}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="notice">{PLAN_COPY[plans[0]!].detail}</p>
      )}

      <div className="upload-form__actions">
        <button type="submit" className="cta" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
