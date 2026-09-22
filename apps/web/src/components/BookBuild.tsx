'use client'

import { useActionState } from 'react'

import { buildEditions, buildMaster, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import { canBuildEpub, canBuildMaster, type SourceKind } from '../domain/publication'
import { canMasterFrom, type BookSource } from '../domain/sources'

const AI_NOTE =
  'Sends your book’s text to xAI, outside NobleSee. A person reviews every suggestion.'

const ADOBE_NOTE =
  'Converting sends your PDF to Adobe PDF Services, outside NobleSee, to have its pages read.'

function label(kind: SourceKind): string {
  return kind === 'text' ? 'TXT' : kind.toUpperCase()
}

function Convert({
  bookId,
  sourceKind,
  aiCorrection,
  busy,
}: {
  bookId: number
  sourceKind: SourceKind
  aiCorrection: boolean
  busy: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(buildMaster, {})

  return (
    <section className="build__card">
      <div>
        <h3>Convert</h3>
        <p className="hint">Converts the original to a master DOCX, from PDF or plain text.</p>
      </div>

      <form action={action}>
        <input type="hidden" name="bookId" value={bookId} />

        <label className="build__toggle">
          <span className="build__toggle-text">
            <strong>AI correction</strong>
            <small>{AI_NOTE}</small>
          </span>
          <input type="checkbox" name="aiCorrection" defaultChecked={aiCorrection} />
        </label>

        {sourceKind === 'pdf' ? <p className="hint">{ADOBE_NOTE}</p> : null}

        <button type="submit" className="cta cta--quiet" disabled={busy || pending}>
          Convert to DOCX
        </button>

        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    </section>
  )
}

function Generate({
  bookId,
  from,
  builtFrom,
  busy,
}: {
  bookId: number
  from: BookSource[]
  builtFrom: SourceKind
  busy: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(buildEditions, {})

  return (
    <section className="build__card">
      <div>
        <h3>Generate EPUB</h3>
        <p className="hint">
          Reflowable EPUB for Kindle and e-readers — ideally from DOCX.
        </p>
      </div>

      <ul className="build__chips">
        {from.map((source) => (
          <li
            key={source.kind}
            className={
              source.kind === builtFrom ? 'build__chip build__chip--used' : 'build__chip'
            }
          >
            {`from ${label(source.kind)}`}
            {source.kind === builtFrom ? ' — used' : null}
          </li>
        ))}
      </ul>

      <form action={action}>
        <input type="hidden" name="bookId" value={bookId} />
        <button type="submit" className="cta" disabled={busy || pending}>
          Generate EPUB
        </button>
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    </section>
  )
}

export function BookBuild({
  bookId,
  sourceKind,
  sources,
  hasMaster,
  aiCorrection,
  converting,
}: {
  bookId: number
  sourceKind: SourceKind
  sources: BookSource[]
  hasMaster: boolean
  aiCorrection: boolean
  converting: boolean
}) {
  const converts = canBuildMaster(sourceKind)
  const generates = canBuildEpub(sourceKind)
  if (!converts && !generates) return null

  const from = sources.filter((source) => canMasterFrom(source.kind))

  return (
    <div className="build">
      {converts ? (
        <Convert
          bookId={bookId}
          sourceKind={sourceKind}
          aiCorrection={aiCorrection}
          busy={converting}
        />
      ) : null}

      {generates ? (
        <Generate
          bookId={bookId}
          from={from}
          builtFrom={hasMaster ? 'docx' : sourceKind}
          busy={converting}
        />
      ) : null}
    </div>
  )
}
