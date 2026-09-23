'use client'

import React, { useRef, useState, type DragEvent, type FormEvent } from 'react'

import { identifyUpload } from '../app/(frontend)/actions/identify'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, sourceKindOf } from '../domain/publication'
import { INTAKE_ERRORS, planIntake } from '../domain/sources'
import { coverSourceFor, makeCoversFor } from '../lib/client/coverImages'

const FIRST_PAGE_NOTE =
  'We send the file names and first page to xAI, outside NobleSee, to read the title, author and language.'

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

interface Sending {
  index: number
  total: number
  percent: number
}

function badge(name: string, type: string): string {
  const kind = sourceKindOf(name, type)
  return kind === 'text' ? 'txt' : (kind ?? 'file')
}

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`
}

function send(
  file: File,
  bookId: number | string | null,
  onProgress: (percent: number) => void,
): Promise<{ bookId?: number | string; error?: string }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest()
    const query = new URLSearchParams({ name: file.name })
    if (bookId !== null) query.set('book', String(bookId))
    request.open('POST', `/api/upload?${query.toString()}`)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })

    request.addEventListener('load', () => {
      let body: { bookId?: number | string; error?: string } = {}
      try {
        body = JSON.parse(request.responseText)
      } catch {
      }

      if (request.status >= 200 && request.status < 300 && body.bookId !== undefined) {
        resolve({ bookId: body.bookId })
        return
      }
      resolve({ error: body.error ?? 'Could not upload that file. Please try again.' })
    })

    request.addEventListener('error', () =>
      resolve({ error: 'The upload was interrupted. Please try again.' }),
    )

    request.send(file)
  })
}

export function UploadForm({ quota }: { quota?: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<File[]>([])

  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<number | string | null>(null)
  const [sending, setSending] = useState<Sending | null>(null)
  const [makingCover, setMakingCover] = useState(false)
  const [reading, setReading] = useState(false)
  const pending = sending !== null

  function accept(files: FileList | null) {
    const picked = files ? Array.from(files) : []
    setChosen(picked)
    setCreated(null)
    setError(refusalFor(picked))
  }

  function refusalFor(files: readonly File[]): string | null {
    if (files.length === 0) return null

    const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES)
    if (oversized) {
      return `${oversized.name} is ${megabytes(oversized.size)} — larger than the ${MAX_UPLOAD_LABEL} limit.`
    }

    const plan = planIntake(
      files.map((file) => ({ name: file.name, kind: sourceKindOf(file.name, file.type) })),
    )
    return plan.ok ? null : `${plan.name} ${INTAKE_ERRORS[plan.reason]}`
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chosen.length === 0 || refusalFor(chosen)) return

    const plan = planIntake(
      chosen.map((file) => ({ name: file.name, kind: sourceKindOf(file.name, file.type), file })),
    )
    if (!plan.ok) return

    const files = plan.ordered.map((entry) => entry.file)

    setError(null)
    setCreated(null)

    let bookId: number | string | null = null
    for (const [index, file] of files.entries()) {
      setSending({ index, total: files.length, percent: 0 })
      const result = await send(file, bookId, (percent) =>
        setSending({ index, total: files.length, percent }),
      )

      if (result.error !== undefined) {
        setSending(null)
        setCreated(bookId)
        setError(
          bookId === null ? result.error : `${file.name} could not be added: ${result.error}`,
        )
        return
      }
      bookId = result.bookId ?? bookId
    }

    if (bookId === null) return
    await finish(bookId, files)
  }

  async function finish(bookId: number | string, files: readonly File[]) {
    const cover =
      files.find((file) => coverSourceFor(file.name, file.type) === 'pdf') ??
      files.find((file) => coverSourceFor(file.name, file.type) !== null)

    if (cover) {
      setMakingCover(true)
      await makeCoversFor(bookId, cover, coverSourceFor(cover.name, cover.type)!)
      setMakingCover(false)
    }

    setReading(true)
    await identifyUpload(Number(bookId))

    window.location.assign(`/account/books/${bookId}`)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)

    const dropped = event.dataTransfer.files
    if (dropped.length === 0 || !inputRef.current) return

    inputRef.current.files = dropped
    accept(dropped)
  }

  return (
    <form onSubmit={submit} className="upload-intake">
      <div className="upload-form">
        <div className="upload-form__head">
          <h3>Select manuscript</h3>
          <p>PDF, TXT, DOCX, or EPUB — up to {MAX_UPLOAD_LABEL} each.</p>
          <p className="hint">{FIRST_PAGE_NOTE}</p>
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
          <span className="visually-hidden">Choose the book’s files</span>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            name="file"
            required
            multiple
            accept={ACCEPT}
            onChange={(event) => accept(event.currentTarget.files)}
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

          {chosen.length > 0 ? (
            <div className="dropzone__chosen">
              <ul className="dropzone__files">
                {chosen.map((file) => (
                  <li key={file.name}>
                    <span className={`fmt fmt--${badge(file.name, file.type)}`}>
                      {badge(file.name, file.type)}
                    </span>
                    <strong>{file.name}</strong>
                  </li>
                ))}
              </ul>
              <span className="dropzone__secondary">Drop others, or click to change them.</span>
            </div>
          ) : (
            <p className="dropzone__primary">Drop your files here</p>
          )}
        </label>

        {sending ? (
          <div
            className="upload-progress"
            role="progressbar"
            aria-valuenow={sending.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
          >
            <span className="upload-progress__bar" style={{ width: `${sending.percent}%` }} />
          </div>
        ) : null}

        {error ? (
          <p className="form-error">
            {error}
            {created !== null ? (
              <>
                {' '}
                <a href={`/account/books/${created}`}>Open the book</a> to add it there.
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="upload-intake__actions">
        <a href="/account/books" className="button-quiet">
          Cancel
        </a>
        <button type="submit" className="cta cta--compact" disabled={pending || error !== null}>
          {reading
            ? 'Reading the file names and first page…'
            : makingCover
              ? 'Making a cover…'
              : sending
                ? sending.total > 1
                  ? `Uploading ${sending.index + 1} of ${sending.total}… ${sending.percent}%`
                  : `Uploading… ${sending.percent}%`
                : 'Continue'}
        </button>
      </div>
    </form>
  )
}
