import React from 'react'

/**
 * Where a book is between "uploaded" and "on your e-reader".
 *
 * Conversion takes minutes to hours for a scan — OCR is the slow part —
 * and a page that says nothing during it reads as a page that has
 * forgotten. Naming the stages also sets the expectation that this is a
 * pipeline with real work in it, not a file format change.
 */

interface Stage {
  key: string
  label: string
  detail: string
}

const STAGES: Stage[] = [
  { key: 'uploaded', label: 'Uploaded', detail: 'Your file is stored and its details read.' },
  { key: 'queued', label: 'Queued', detail: 'Waiting for a converter to collect it.' },
  {
    key: 'converting',
    label: 'Reading the pages',
    detail: 'OCR for a scan, then structure — headings, paragraphs, verse.',
  },
  {
    key: 'master',
    label: 'DOCX master',
    detail: 'The editable source of truth. Yours to download and correct.',
  },
  {
    key: 'formats',
    label: 'EPUB and PDFs',
    detail: 'Generated from that master: EPUB, and PDF in three sizes.',
  },
  { key: 'ready', label: 'Ready', detail: 'Read it here, or send it to your e-reader.' },
]

/**
 * How far along a conversion state is.
 *
 * The middle stages are not separately reported — the converter moves
 * through them faster than anyone polls — so they are shown as one
 * block of work rather than pretending to a precision we do not have.
 */
const REACHED: Record<string, number> = {
  draft: 0,
  queued: 1,
  converting: 2,
  ready: 5,
  none: 5,
  failed: 2,
}

/**
 * How long a book may sit queued before the wait is worth explaining.
 *
 * A converter polls every thirty seconds, so a book that has been
 * queued for a quarter of an hour is not waiting its turn — nothing is
 * listening. Saying "waiting for a converter to pick it up" then is
 * technically true and practically a lie.
 */
const STALE_AFTER_MS = 15 * 60 * 1000

export function ConversionProgress({
  state,
  message,
  queuedSince,
}: {
  state: string
  message?: string | null
  /** When the book entered the pipeline, if it has. */
  queuedSince?: string | null
}) {
  const reached = REACHED[state] ?? 0
  const failed = state === 'failed'
  const stalled =
    state === 'queued' &&
    Boolean(queuedSince) &&
    Date.now() - new Date(queuedSince!).getTime() > STALE_AFTER_MS

  return (
    <section className="pipeline">
      <h3>What happens to your book</h3>
      <ol className="pipeline__stages">
        {STAGES.map((stage, index) => {
          const done = !failed && index < reached
          const current = !failed && index === reached
          return (
            <li
              key={stage.key}
              className={`pipeline__stage${done ? ' pipeline__stage--done' : ''}${
                current ? ' pipeline__stage--current' : ''
              }`}
              aria-current={current ? 'step' : undefined}
            >
              <span className="pipeline__mark" aria-hidden="true">
                {done ? '✓' : index + 1}
              </span>
              <span className="pipeline__text">
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {stalled ? (
        <p className="notice">
          No converter has collected this yet. Conversion runs on a separate service that is not
          online at the moment — your book and its details are safe, and it will be picked up as
          soon as one is running.
        </p>
      ) : null}

      {failed ? (
        <p className="form-error">
          {message || 'The conversion did not finish.'} Your file and details are still here —
          you can correct them and try again.
        </p>
      ) : null}
    </section>
  )
}
