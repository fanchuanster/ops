'use client'

import { useActionState, useRef, useState, type FormEvent } from 'react'

import { chooseMasterSource, type SourceState } from '../app/(frontend)/actions/sources'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type SourceKind } from '../domain/publication'
import { type BookSource, canMasterFrom, offersMasterChoice } from '../domain/sources'

/**
 * The files a book was made from, and which one its master comes from.
 *
 * Most books have one file and this panel is then a statement rather
 * than a question: here is your scan, the master is built from it,
 * here is how to add something else. The panel earns its place on the
 * book that has two — a scan and a transcription of the same work — and
 * the question it answers is the one nobody could answer at upload,
 * because it depends on how the conversion actually turned out.
 *
 * ## Why the choice is offered here and not on the details form
 *
 * The details form is where a book's *facts* are confirmed, once,
 * before anything has happened to it. This is a decision its owner
 * takes with the results in front of them — they have read the EPUB
 * Adobe's reading of the scan produced, seen what it got wrong, and now
 * want the master built from the text file instead. Putting it on the
 * form would ask the question at the one moment there is no evidence to
 * answer it with.
 *
 * ## The two acts, kept apart
 *
 * **Adding a file** is free, instant and reversible: it is copied under
 * the book and nothing else changes. **Building the master from it**
 * costs a conversion out of the month's allowance and re-runs phase 1.
 * They are two controls for that reason and not because the flow needs
 * two steps — a reader should be able to park a transcription beside a
 * scan without committing to anything.
 *
 * Uploading goes to `/api/upload?book=` as the raw request body, the
 * same path and the same 100 MB ceiling as the first upload, over
 * `XMLHttpRequest` for the same reason: it is the only way to report
 * progress, and a 60 MB scan going up with no sign of movement reads as
 * a hang.
 */

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

/** The badge a kind wears, which is the artifact slot it occupies. */
function badge(kind: SourceKind): string {
  return kind === 'text' ? 'txt' : kind
}

/** What each kind is, said the way its owner would say it. */
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
  /** The kind the master is currently built from. */
  selected: SourceKind
  /** Whether one has actually been built yet, which is only a tense. */
  hasMaster: boolean
  /** The pipeline is holding this book, so switching now would race it. */
  converting: boolean
}) {
  const [state, action, pending] = useActionState<SourceState, FormData>(chooseMasterSource, {})

  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  /** Null when idle; 0-100 while the file is going up. */
  const [progress, setProgress] = useState<number | null>(null)
  const uploading = progress !== null

  const choosable = offersMasterChoice(sources)

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = inputRef.current?.files?.[0]
    if (!file) return

    // Courtesy, not the boundary — the route enforces the same number.
    // Hearing it from the server costs the whole upload.
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
        // A proxy or the platform answered instead of the route.
      }

      if (request.status >= 200 && request.status < 300) {
        // A full reload rather than a router refresh: the panel is
        // rendered from the book row on the server, and this is the one
        // moment the whole page's shape changes — a second source turns
        // a statement into a choice.
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

              {/* Only when there is something to distinguish it from,
                  and only against a file a master could actually come
                  from. A book with one source needs no mark — there is
                  no other row for it to be picked out of — and a book
                  whose one source is an EPUB has `selected` set to it
                  regardless, because everything downstream reads that
                  field, so marking it would claim a master that will
                  never be built. The row's own line already says why. */}
              {choosable && isSelected && usable ? (
                <span className="sources__mark">
                  {hasMaster ? 'The master came from this' : 'The master will come from this'}
                </span>
              ) : !isSelected && usable && choosable ? (
                /* One form per row rather than radios and a save
                   button. There is nothing to accumulate — the choice
                   takes effect the moment it is made, and it costs a
                   conversion, so the control should read as the act it
                   is rather than as a setting. */
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

      {/* Said once, under the list, rather than on every button: it is
          the same warning for whichever row it is clicked on. */}
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
