'use client'

import React, { useActionState, useRef, useState, type DragEvent } from 'react'

import { uploadBook, type UploadState } from '../app/(frontend)/actions/upload'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../domain/publication'

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
 */

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

/** The four things the portal takes, in the order section 3 lists them. */
const FORMATS = ['pdf', 'docx', 'epub', 'txt'] as const

export function UploadForm({ quota }: { quota?: React.ReactNode }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadBook, {})

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  // Checked here as well as in the action, because the server's answer
  // to an oversized file costs the whole upload to hear. The action
  // still enforces it — this is courtesy, not the boundary.
  const [tooBig, setTooBig] = useState<string | null>(null)

  function accept(file: File | undefined) {
    setChosen(file?.name ?? null)
    setTooBig(
      file && file.size > MAX_UPLOAD_BYTES
        ? `That file is ${Math.round(file.size / 1024 / 1024)} MB — larger than the ${MAX_UPLOAD_LABEL} limit.`
        : null,
    )
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)

    const dropped = event.dataTransfer.files
    if (dropped.length === 0 || !inputRef.current) return

    // Assigning the FileList onto the real input rather than keeping the
    // File in state: the form is submitted by a server action, so the
    // file has to be *in* the form to be sent. State would show a
    // filename and upload nothing.
    inputRef.current.files = dropped
    accept(dropped[0])
  }

  return (
    <form action={action} className="upload-form">
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
          {pending ? 'Reading your file…' : 'Upload'}
        </button>
      </div>

      {tooBig ?? state.error ? <p className="form-error">{tooBig ?? state.error}</p> : null}
    </form>
  )
}
