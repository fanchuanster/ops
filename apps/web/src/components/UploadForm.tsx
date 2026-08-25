'use client'

import React, { useRef, useState, type DragEvent, type FormEvent } from 'react'

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../domain/publication'
import { coverSourceFor, makeCoversFor } from '../lib/client/coverImages'

/**
 * The conversion portal's first step: the file, and nothing else.
 *
 * It used to ask for a title, an author and the rights answer up front.
 * Two of those the file already knows, and asking someone to retype
 * what they just uploaded is the kind of friction that stops uploads
 * happening. What the file says is read out of it and shown on the next
 * page, where it can be corrected — see `BookDetailsForm`.
 *
 * Note what is still *not* here, and will not be on the next page
 * either: no visibility control, no reading level. Those are
 * administrator fields (CLAUDE.md section 6.1), and an uploader who
 * could set them would walk their upload into the front of the library.
 *
 * The drop zone is a `<label>` wrapping a hidden-but-real file input,
 * not a div with a click handler. That is what keeps it keyboard
 * reachable and correctly announced without reimplementing any of it —
 * dragging is the enhancement, and clicking or tabbing to it is the
 * path that always works.
 *
 * Submitting is an explicit request rather than a server action, and
 * the file is the request body rather than a field in a multipart form
 * (`api/upload/route.ts`). That is what lets a 100 MB book stream into
 * storage instead of being parsed into a Worker's memory — and, since
 * the request is ours, it is also what makes the progress bar below
 * possible. `XMLHttpRequest` rather than `fetch`: only XHR reports
 * upload progress, and a reader watching a 100 MB file go up with no
 * indication of movement assumes it has hung.
 */

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

/** The four things the portal takes, in the order section 3 lists them. */
const FORMATS = ['pdf', 'docx', 'epub', 'txt'] as const

export function UploadForm({ quota }: { quota?: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  /** Null when idle; 0-100 while the file is going up. */
  const [progress, setProgress] = useState<number | null>(null)
  /** The upload is done and this browser is rendering the cover. */
  const [makingCover, setMakingCover] = useState(false)
  const pending = progress !== null

  // Checked here as well as in the route, because the server's answer
  // to an oversized file costs the whole upload to hear. The route
  // still enforces it — this is courtesy, not the boundary.
  const [tooBig, setTooBig] = useState<string | null>(null)

  function accept(file: File | undefined) {
    setChosen(file?.name ?? null)
    setError(null)
    setTooBig(
      file && file.size > MAX_UPLOAD_BYTES
        ? `That file is ${Math.round(file.size / 1024 / 1024)} MB — larger than the ${MAX_UPLOAD_LABEL} limit.`
        : null,
    )
  }

  /**
   * Send the file as the request body and go to the draft it became.
   *
   * The whole response is read before navigating, because the route
   * answers with the new book's id — there is no redirect to follow, by
   * design: `fetch` and XHR both follow a 3xx themselves, and the
   * reader would never move.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const file = inputRef.current?.files?.[0]
    if (!file || tooBig) return

    setError(null)
    setProgress(0)

    const request = new XMLHttpRequest()
    request.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}`)
    // The type the browser guessed, which the route re-checks against
    // the filename — several browsers send octet-stream for an EPUB.
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    request.upload.addEventListener('progress', (progressEvent) => {
      if (!progressEvent.lengthComputable) return
      setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100))
    })

    request.addEventListener('load', () => {
      let body: { bookId?: string | number; error?: string } = {}
      try {
        body = JSON.parse(request.responseText)
      } catch {
        // A proxy or the platform answered instead of the route — most
        // likely the request never reached us at all.
      }

      if (request.status >= 200 && request.status < 300 && body.bookId !== undefined) {
        void finish(body.bookId, file)
        return
      }

      setProgress(null)
      setError(body.error ?? 'Could not upload that file. Please try again.')
    })

    request.addEventListener('error', () => {
      setProgress(null)
      setError('The upload was interrupted. Please try again.')
    })

    request.addEventListener('abort', () => setProgress(null))

    request.send(file)
  }

  /**
   * Render the cover, then go to the draft.
   *
   * The wait is a second or two for a scan and nothing at all for a
   * file that has no pages to rasterize, so it is shown rather than
   * hidden: a progress bar that sits at 100% with no explanation reads
   * as a hang.
   */
  async function finish(bookId: string | number, file: File) {
    const source = coverSourceFor(file.name, file.type)
    if (source) {
      setMakingCover(true)
      await makeCoversFor(bookId, file, source)
    }

    // Not `router.push`: the draft page must load fresh, and this
    // navigation ends the upload rather than continuing the session.
    window.location.assign(`/account/books/${bookId}`)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)

    const dropped = event.dataTransfer.files
    if (dropped.length === 0 || !inputRef.current) return

    // Assigning the FileList onto the real input rather than keeping the
    // File in state: the input is what `submit` reads the file back
    // from, and it is also what keeps the native `required` check
    // honest. State would show a filename and upload nothing.
    inputRef.current.files = dropped
    accept(dropped[0])
  }

  return (
    <form onSubmit={submit} className="upload-form">
      <div className="upload-form__head">
        <h3>Select manuscript</h3>
        <p>PDF, DOCX, EPUB, or plain text — up to {MAX_UPLOAD_LABEL}</p>
        {quota}
      </div>

      <label
        className="dropzone"
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="visually-hidden">Choose a book file</span>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          name="file"
          required
          accept={ACCEPT}
          onChange={(event) => accept(event.currentTarget.files?.[0])}
        />

        <span className="dropzone__icon" aria-hidden="true">
          <svg viewBox="0 0 22 22" fill="none">
            <path
              d="M11 15V7M11 7L7.5 10.5M11 7L14.5 10.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16V17C4 18.1046 4.89543 19 6 19H16C17.1046 19 18 18.1046 18 17V16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>

        {chosen ? (
          <p className="dropzone__chosen">
            <strong>{chosen}</strong>
            <br />
            <span className="dropzone__secondary">Drop another, or click to change it.</span>
          </p>
        ) : (
          <>
            <p className="dropzone__primary">Drop your file here</p>
            <p className="dropzone__secondary">or click to browse</p>
          </>
        )}

        <span className="formats-row" aria-hidden="true">
          {FORMATS.map((format) => (
            <span key={format} className={`fmt fmt--${format}`}>
              {format}
            </span>
          ))}
        </span>
      </label>

      <div className="upload-form__actions">
        <button type="submit" className="cta" disabled={pending || tooBig !== null}>
          {makingCover ? 'Making a cover…' : pending ? `Uploading… ${progress}%` : 'Upload'}
        </button>
      </div>

      {pending ? (
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

      {tooBig ?? error ? <p className="form-error">{tooBig ?? error}</p> : null}
    </form>
  )
}
