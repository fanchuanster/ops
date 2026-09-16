'use client'

import { useActionState, useRef, useState, type FormEvent } from 'react'

import { chooseMasterSource, type SourceState } from '../app/(frontend)/actions/sources'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type SourceKind } from '../domain/publication'
import { type BookSource, canMasterFrom, offersMasterChoice } from '../domain/sources'

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

function badge(kind: SourceKind): string {
  return kind === 'text' ? 'txt' : kind
}

const WHAT_IT_IS: Record<SourceKind, string> = {
  pdf: 'Read by Adobe’s PDF Services, outside NobleSee, then rebuilt as a reflowable book.',
  text: 'Parsed into chapters here. Nothing leaves NobleSee.',
  docx: 'A Word document is already the master, so nothing has to be built at all.',
  epub: 'Already a reading edition — there is nothing to build from it.',
}

function size(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function BookSources({
  bookId,
  sources,
  selected,
  hasMaster,
  converting,
}: {
  bookId: number
  sources: BookSource[]
  selected: SourceKind
  hasMaster: boolean
  converting: boolean
}) {
  const [state, action, pending] = useActionState<SourceState, FormData>(chooseMasterSource, {})

  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const uploading = progress !== null

  const choosable = offersMasterChoice(sources)

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = inputRef.current?.files?.[0]
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${Math.round(file.size / 1024 / 1024)} MB — larger than the ${MAX_UPLOAD_LABEL} limit.`,
      )
      return
    }

    setError(null)
    setProgress(0)

    const request = new XMLHttpRequest()
    request.open(
      'POST',
      `/api/upload?book=${bookId}&name=${encodeURIComponent(file.name)}`,
    )
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      setProgress(Math.round((event.loaded / event.total) * 100))
    })

    request.addEventListener('load', () => {
      let body: { error?: string } = {}
      try {
        body = JSON.parse(request.responseText)
      } catch {
      }

      if (request.status >= 200 && request.status < 300) {
        window.location.reload()
        return
      }

      setProgress(null)
      setError(body.error ?? 'Could not add that file. Please try again.')
    })

    request.addEventListener('error', () => {
      setProgress(null)
      setError('The upload was interrupted. Please try again.')
    })

    request.send(file)
  }

  return (
    <section className="sources">
      <h3>Source files</h3>
      <p className="hint">
        {choosable
          ? 'This book has more than one original. The master — and everything read from it — is built from the one marked below.'
          : 'What this book was made from. The original is always kept, whatever else is built.'}
      </p>

      <ul className="sources__list">
        {sources.map((source) => {
          const isSelected = source.kind === selected
          const usable = canMasterFrom(source.kind)
          return (
            <li
              key={source.kind}
              className={`sources__item${isSelected ? ' sources__item--current' : ''}`}
            >
              <span className={`fmt fmt--${badge(source.kind)}`}>{badge(source.kind)}</span>

              <span className="sources__name">
                {source.filename || `${badge(source.kind)} file`}
                {size(source.bytes) ? (
                  <small className="sources__size">{size(source.bytes)}</small>
                ) : null}
                <small className="sources__what">{WHAT_IT_IS[source.kind]}</small>
              </span>

              {choosable && isSelected && usable ? (
                <span className="sources__mark">
                  {hasMaster ? 'The master came from this' : 'The master will come from this'}
                </span>
              ) : !isSelected && usable && choosable ? (
                <form action={action} className="sources__switch">
                  <input type="hidden" name="bookId" value={bookId} />
                  <input type="hidden" name="kind" value={source.kind} />
                  <button
                    type="submit"
                    className="button-quiet"
                    disabled={pending || converting}
                  >
                    {pending ? 'Switching…' : 'Build the master from this'}
                  </button>
                </form>
              ) : null}
            </li>
          )
        })}
      </ul>

      {choosable && !converting ? (
        <p className="hint sources__cost">
          Switching rebuilds the master and the EPUB from the file you pick, and counts as one
          of this month’s conversions. Nothing is deleted — the other file stays, and you can
          switch back.
        </p>
      ) : null}

      {converting ? (
        <p className="hint">
          This book is converting. You can choose a different source once it has finished.
        </p>
      ) : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}

      <form onSubmit={upload} className="sources__add">
        <label>
          <span>Add another file</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            required
            onChange={() => setError(null)}
          />
          <small>
            A transcription to convert instead of the scan, or a scan to keep beside the text.
            One file of each type — up to {MAX_UPLOAD_LABEL}. Adding one costs nothing and
            changes nothing until you choose it.
          </small>
        </label>
        <button type="submit" className="button-quiet" disabled={uploading}>
          {uploading ? `Uploading… ${progress}%` : 'Add file'}
        </button>

        {uploading ? (
          <div
            className="upload-progress"
            role="progressbar"
            aria-valuenow={progress ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
          >
            <span className="upload-progress__bar" style={{ width: `${progress}%` }} />
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </section>
  )
}
