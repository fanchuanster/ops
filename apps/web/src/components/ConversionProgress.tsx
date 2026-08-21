import React from 'react'

import {
  type PublicationPlan,
  type SourceKind,
  formatsToGenerate,
  needsConverter,
} from '../domain/publication'

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

/**
 * The stages a book will actually pass through.
 *
 * Not one list. Every long-running stage here is queued work picked up
 * by a worker, and which queues a book joins depends entirely on what
 * was uploaded and what its owner chose — so showing a scan's five
 * stages to someone who uploaded an EPUB would be promising work that
 * will never happen.
 */
function stagesFor(kind: SourceKind, plan: PublicationPlan): Stage[] {
  const uploaded: Stage = {
    key: 'uploaded',
    label: 'Uploaded',
    detail: 'Your file is stored and its details read.',
  }
  const ready: Stage = {
    key: 'ready',
    label: 'Ready',
    detail: 'Read it here, or send it to your e-reader.',
  }

  // Nothing is converted, so there is no queue to wait in. The file is
  // filed under the book and that is the whole of it.
  if (!needsConverter(kind, plan)) {
    return [
      uploaded,
      {
        key: 'ready',
        label: 'Published as it is',
        detail:
          kind === 'epub'
            ? 'An EPUB is already a reading edition, so nothing needed converting.'
            : 'Your PDF is the published edition, exactly as you uploaded it.',
      },
    ]
  }

  const queued: Stage = {
    key: 'queued',
    label: 'Queued',
    detail: 'Waiting for a worker to pick it up.',
  }
  const formats: Stage = {
    key: 'formats',
    label: 'EPUB' + (formatsToGenerate(kind).includes('pdf') ? ' and PDF' : ''),
    detail: 'Generated from the master, and rebuilt whenever you correct it.',
  }

  // A DOCX is already the master, so it skips both the reading and the
  // mastering and goes straight into the format queue.
  if (kind === 'docx') {
    return [uploaded, queued, { ...MASTER_STAGE, detail: 'Your DOCX, which is the master.' }, formats, ready]
  }

  return [
    uploaded,
    queued,
    {
      key: 'ocr',
      label: 'Reading the pages',
      detail:
        'OCR for a scan, which also produces the master. The slow part — minutes to hours for a long book.',
    },
    MASTER_STAGE,
    formats,
    ready,
  ]
}

const MASTER_STAGE: Stage = {
  key: 'master',
  label: 'DOCX master',
  detail: 'The editable source of truth. Yours to download and correct.',
}

/**
 * Which stage a conversion state is *in*.
 *
 * A stage key rather than an index, because the list of stages is no
 * longer fixed — a DOCX upload has four and an EPUB upload has two, so
 * an index into "the" stage list would point at different things for
 * different books. The key is looked up in whichever list is being
 * shown; a key that is not in it means the book has already passed
 * everything that list contains.
 */
const STAGE_OF: Record<string, string> = {
  draft: 'uploaded',
  queued: 'queued',
  ocr: 'ocr',
  // A source that needed no reading. What remains of phase 1 is the
  // converter building the master from it.
  ocr_ready: 'master',
  mastering: 'master',
  // Phase 1 is done. The master exists and the formats are queued —
  // which is also where a book sits after its master is corrected.
  master_ready: 'formats',
  formatting: 'formats',
  ready: 'done',
  none: 'done',
  failed: 'ocr',
}

/**
 * States that mean "a converter has to pick this up".
 *
 * A scan's OCR and master are run by this application, but nothing else
 * is — and the converter's own polling is what drives even those stages
 * forward (`lib/masterPipeline.ts`). So with no converter running, a
 * book stalls wherever it is, and these are the places it stalls.
 */
const AWAITING_CONVERTER = new Set(['queued', 'ocr_ready', 'master_ready'])

/**
 * States where something is actually running right now.
 *
 * The complement of `AWAITING_CONVERTER` among the unfinished states,
 * and the distinction is the whole reason the bar below is worth
 * drawing: "a worker is reading your pages" and "nothing has picked
 * this up yet" look identical on a stage list, and they mean opposite
 * things to someone deciding whether to wait.
 *
 * The bar is deliberately indeterminate. Nothing reports a percentage —
 * Adobe's export and the converter's render are both opaque until they
 * finish — and a bar that creeps to 90% on a timer is a lie told
 * smoothly. This one says "moving", which is all we know.
 */
const WORKING = new Set(['ocr', 'mastering', 'formatting'])

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
  sourceKind,
  plan,
}: {
  state: string
  message?: string | null
  /** When the book entered the pipeline, if it has. */
  queuedSince?: string | null
  sourceKind: SourceKind
  plan: PublicationPlan
}) {
  const stages = stagesFor(sourceKind, plan)
  const key = STAGE_OF[state] ?? 'uploaded'
  const found = stages.findIndex((stage) => stage.key === key)
  // Not in this book's list means past the end of it — every stage
  // done. That is what carries a finished book, and any state a shorter
  // path skips over, to the right place.
  const reached = found === -1 ? stages.length : found
  const failed = state === 'failed'
  const stalled =
    AWAITING_CONVERTER.has(state) &&
    Boolean(queuedSince) &&
    Date.now() - new Date(queuedSince!).getTime() > STALE_AFTER_MS

  return (
    // Labelled for assistive technology rather than with a heading. On
    // the draft page this list sits directly under the details form in
    // one wizard flow, and a second heading over it read as a new
    // section starting rather than as the next thing that happens.
    <section className="pipeline" aria-label="What happens to your book">
      <ol className="pipeline__stages">
        {stages.map((stage, index) => {
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
                {current && WORKING.has(state) ? (
                  <span className="pipeline__working" aria-label="In progress" />
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>

      {stalled ? (
        <p className="notice">
          {needsConverter(sourceKind, plan)
            ? 'No worker has collected this yet. The conversion queues are served by a separate service that is not online at the moment — your book and its details are safe, and it will be picked up as soon as one is running.'
            : 'This is still waiting to be filed. Nothing about your book needs converting, but the queue it is in is served by a service that is not online at the moment — your file and its details are safe.'}
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
