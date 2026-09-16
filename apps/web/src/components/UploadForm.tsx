'use client'

import React, { useRef, useState, type DragEvent, type FormEvent } from 'react'

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../domain/publication'
import { coverSourceFor, makeCoversFor } from '../lib/client/coverImages'

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

const FORMATS = ['pdf', 'docx', 'epub', 'txt'] as const

export function UploadForm({ quota }: { quota?: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [makingCover, setMakingCover] = useState(false)
  const pending = progress !== null

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const file = inputRef.current?.files?.[0]
    if (!file || tooBig) return

    setError(null)
    setProgress(0)

    const request = new XMLHttpRequest()
    request.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}`)
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

  async function finish(bookId: string | number, file: File) {
    const source = coverSourceFor(file.name, file.type)
    if (source) {
      setMakingCover(true)
      await makeCoversFor(bookId, file, source)
    }

    window.location.assign(`/account/books/${bookId}`)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)

    const dropped = event.dataTransfer.files
    if (dropped.length === 0 || !inputRef.current) return

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
