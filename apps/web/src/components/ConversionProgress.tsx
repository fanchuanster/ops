import React from 'react'

import {
  type PublicationPlan,
  type SourceKind,
  needsConverter,
} from '../domain/publication'

interface Stage {
  key: string
  label: string
  detail: string
}

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

  if (!needsConverter(kind, plan)) {
    return [
      uploaded,
      {
        key: 'ready',
        label: 'Published as it is',
        detail:
          kind === 'epub'
            ? 'An EPUB is already a reading edition, so nothing needed converting.'
            : kind === 'text'
              ? 'Your text is the published edition, exactly as you uploaded it. It reflows already; converting would add chapters and a contents list.'
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
    label: 'EPUB',
    detail: 'Generated from the master, and rebuilt whenever you correct it.',
  }

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

const STAGE_OF: Record<string, string> = {
  draft: 'uploaded',
  queued: 'queued',
  ocr: 'ocr',
  ocr_ready: 'master',
  mastering: 'master',
  master_ready: 'formats',
  formatting: 'formats',
  ready: 'done',
  none: 'done',
  failed: 'ocr',
}

const AWAITING_CONVERTER = new Set(['queued', 'ocr_ready', 'master_ready'])

const WORKING = new Set(['ocr', 'mastering', 'formatting'])

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
  queuedSince?: string | null
  sourceKind: SourceKind
  plan: PublicationPlan
}) {
  const stages = stagesFor(sourceKind, plan)
  const key = STAGE_OF[state] ?? 'uploaded'
  const found = stages.findIndex((stage) => stage.key === key)
  const reached = found === -1 ? stages.length : found
  const failed = state === 'failed'
  const stalled =
    AWAITING_CONVERTER.has(state) &&
    Boolean(queuedSince) &&
    Date.now() - new Date(queuedSince!).getTime() > STALE_AFTER_MS

  return (
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

      {!failed && message ? <p className="notice">{message}</p> : null}

      {stalled && !message ? (
        <p className="notice">
          {needsConverter(sourceKind, plan)
            ? 'Nothing has picked this up yet. Conversions are run by a scheduled job on the site itself, so this is a fault rather than a queue — your book and its details are safe, and it will convert as soon as the job is running again.'
            : 'This is still waiting to be filed. Nothing about your book needs converting, so this is a fault rather than a queue — your file and its details are safe.'}
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
