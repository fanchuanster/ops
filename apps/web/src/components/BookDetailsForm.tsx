'use client'

import { type CSSProperties, useActionState, useState } from 'react'

import { saveBookDetails, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import {
  type PublicationPlan,
  type SourceKind,
  defaultPlanFor,
  plansFor,
} from '../domain/publication'

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
  sourceKind: SourceKind
  plan: PublicationPlan
  aiCorrection: boolean
}

const PLAN_COPY: Record<
  SourceKind,
  Partial<
    Record<PublicationPlan, { tag: string; label: string; detail: string; sends?: string }>
  >
> = {
  pdf: {
    convert: {
      tag: 'Best to read',
      label: 'Convert & Generate',
      detail:
        'Pages are read and text is rebuilt to reflow — adjustable size, chapter navigation, readable on any device. Produces an EPUB. Takes a while, and you can start it later.',
      sends:
        'Your file is sent to Adobe’s PDF Services, outside NobleSee, to have its pages read. Only choose this for material you are willing to hand to them.',
    },
    as_is: {
      tag: 'Recommended',
      label: 'Submit PDF for Review',
      detail:
        'Publish exactly what you uploaded, ready straight away. Perfect fidelity — but text won’t reflow, so it can’t adapt to a Kindle’s screen. Convert later if you change your mind.',
      sends: 'Nothing leaves NobleSee. Your file is stored and published as it is.',
    },
  },
  text: {
    convert: {
      tag: 'Best to read',
      label: 'Convert & Generate',
      detail:
        'Your text is rebuilt into a structured book — chapters, a contents list, a proper EPUB. Takes a while, and you can start it later.',
      sends: 'Converted here. Nothing leaves NobleSee unless you ask for AI correction below.',
    },
    as_is: {
      tag: 'Recommended',
      label: 'Submit text for Review',
      detail:
        'Publish the text exactly as you uploaded it, ready straight away. It already reflows, so it reads and sends to a Kindle fine — it just arrives without chapters or a contents list. Convert later if you change your mind.',
      sends: 'Nothing leaves NobleSee. Your text is stored and published as it is.',
    },
  },
  docx: {
    convert: {
      tag: 'Best to read',
      label: 'Convert & Generate',
      detail:
        'Your Word document is the editable master already, so this goes straight to building the EPUB a reader gets.',
      sends: 'Converted here. Nothing leaves NobleSee unless you ask for AI correction below.',
    },
  },
  epub: {
    as_is: {
      tag: 'Ready',
      label: 'Publish as it is',
      detail:
        'An EPUB is already a reading edition — reflowable, navigable, exactly what a reader wants. Nothing needs converting.',
      sends: 'Nothing leaves NobleSee. Your file is stored and published as it is.',
    },
  },
}

function planCopy(kind: SourceKind, plan: PublicationPlan) {
  return PLAN_COPY[kind][plan] ?? PLAN_COPY.pdf[plan]!
}

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
  collections: { id: number; title: string; depth: number }[]
  draft?: boolean
  submitLabel?: string
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveBookDetails, {})

  const plans = plansFor(book.sourceKind)

  const [plan, setPlan] = useState<PublicationPlan>(book.plan)

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
                defaultChecked={book.collection === null}
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
                  defaultChecked={book.collection === collection.id}
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
          {plans.map((option) => (
            <label key={option} className="plan-card">
              <input
                type="radio"
                name="plan"
                value={option}
                checked={option === plan}
                onChange={() => setPlan(option)}
              />
              <span
                className={`plan-card__tag${
                  option === defaultPlanFor(book.sourceKind) ? ' plan-card__tag--recommended' : ''
                }`}
              >
                {planCopy(book.sourceKind, option).tag}
              </span>
              <strong>{planCopy(book.sourceKind, option).label}</strong>
              <span>{planCopy(book.sourceKind, option).detail}</span>
              {planCopy(book.sourceKind, option).sends ? (
                <span className="plan-card__sends">{planCopy(book.sourceKind, option).sends}</span>
              ) : null}
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <p className="notice">{planCopy(book.sourceKind, plans[0]!).detail}</p>
          {planCopy(book.sourceKind, plans[0]!).sends ? (
            <p className="notice notice--sends">{planCopy(book.sourceKind, plans[0]!).sends}</p>
          ) : null}
        </>
      )}

      {plan === 'convert' ? (
        <label className="ai-consent">
          <input
            type="checkbox"
            name="aiCorrection"
            defaultChecked={book.aiCorrection}
          />
          <span>
            <strong>Use AI to suggest corrections</strong>
            <span>
              Sends your book’s text to xAI, a service outside NobleSee, which proposes fixes for
              scanning and typing errors. Every suggestion is reviewed by a person before anything
              changes — nothing is rewritten on its own. Leave this off and your text stays here.
            </span>
          </span>
        </label>
      ) : null}

      <div className="upload-form__actions">
        <button type="submit" className="cta" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
