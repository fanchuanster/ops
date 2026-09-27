'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import {
  buildEditions,
  buildMaster,
  replaceMaster,
  type DetailsState,
} from '../app/(frontend)/actions/bookDetails'
import { canBuildEpub, canBuildMaster, type SourceKind } from '../domain/publication'

const AI_NOTE =
  'Sends your book’s text to xAI, outside NobleSee. A person reviews every suggestion.'

const ADOBE_NOTE =
  'Converting sends your PDF to Adobe PDF Services, outside NobleSee, to have its pages read.'

function ConvertAction({
  bookId,
  busy,
}: {
  bookId: number
  busy: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(buildMaster, {})
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pendingOrBusy = busy || pending

  useEffect(() => {
    if (!open) return

    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <form action={action} className="files__action">
      <input type="hidden" name="bookId" value={bookId} />
      <div className="split-button split-button--quiet" ref={box}>
        <button
          type="submit"
          name="aiCorrection"
          value="off"
          className="cta cta--quiet"
          disabled={pendingOrBusy}
        >
          Convert
        </button>

        <button
          type="button"
          className="split-button__toggle"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More convert options"
          disabled={pendingOrBusy}
          onClick={() => setOpen((was) => !was)}
        >
          <span aria-hidden="true">▾</span>
        </button>

        {open ? (
          <div className="split-button__menu" role="menu">
            <button
              type="submit"
              role="menuitem"
              name="aiCorrection"
              value="on"
              disabled={pendingOrBusy}
              className="split-button__item"
              onClick={close}
            >
              Convert with AI correction
              <span className="split-button__note">{AI_NOTE}</span>
            </button>
          </div>
        ) : null}
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}

function GenerateAction({
  bookId,
  busy,
  disabled,
}: {
  bookId: number
  busy: boolean
  disabled: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(buildEditions, {})

  return (
    <form action={action} className="files__action">
      <input type="hidden" name="bookId" value={bookId} />
      <button type="submit" className="cta" disabled={disabled || busy || pending}>
        Generate
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}

export function BookFiles({
  bookId,
  slug,
  sourceKind,
  hasMaster,
  hasEpub,
  aiCorrection,
  converting,
}: {
  bookId: number
  slug: string
  sourceKind: SourceKind
  hasMaster: boolean
  hasEpub: boolean
  aiCorrection: boolean
  converting: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(replaceMaster, {})
  const canConvert = canBuildMaster(sourceKind)
  const canGenerate = canBuildEpub(sourceKind)

  return (
    <section className="master">
      <h3>Files</h3>

      <ul className="files">
        <li className="files__row">
          <span className="fmt fmt--docx">docx</span>
          <span className="files__what">Master copy</span>
          {hasMaster ? (
            <a href={`/account/books/${bookId}/master`}>Download</a>
          ) : (
            <span className="files__state">Not converted yet</span>
          )}
          {hasMaster && aiCorrection ? (
            <span className="build__chip build__chip--used">AI-corrected</span>
          ) : null}
          {canConvert ? <ConvertAction bookId={bookId} busy={converting} /> : null}
        </li>

        {canGenerate ? (
          <li className="files__row">
            <span className="fmt fmt--epub">epub</span>
            <span className="files__what">Reader edition</span>
            {hasEpub ? (
              <a href={`/read/${slug}`}>Read it</a>
            ) : (
              <span className="files__state">Not generated yet</span>
            )}
            <GenerateAction bookId={bookId} busy={converting} disabled={!hasMaster} />
          </li>
        ) : null}
      </ul>

      {canConvert && sourceKind === 'pdf' ? <p className="hint">{ADOBE_NOTE}</p> : null}
      {canGenerate && !hasMaster ? (
        <p className="hint">Generating the EPUB needs a DOCX master copy first.</p>
      ) : null}

      {hasMaster ? (
        <form action={action} className="master__replace">
          <input type="hidden" name="bookId" value={bookId} />
          <label>
            <span>Upload a corrected master</span>
            <input
              type="file"
              name="master"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
            />
            <small>
              The EPUB and PDFs are rebuilt from it. The pages are not read again, so this is
              quick and does not count against your monthly limit.
            </small>
          </label>
          <button type="submit" className="button-quiet" disabled={pending}>
            {pending ? 'Uploading…' : 'Replace and rebuild'}
          </button>
          {state.error ? <p className="form-error">{state.error}</p> : null}
        </form>
      ) : null}
    </section>
  )
}
