'use client'

import { useRef, useState, type FormEvent } from 'react'

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../domain/publication'

const ACCEPT =
  '.pdf,.docx,.epub,.txt,.md,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/epub+zip,text/plain,text/markdown'

export function AddSourceFile({ bookId }: { bookId: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const uploading = progress !== null

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
    request.open('POST', `/api/upload?book=${bookId}&name=${encodeURIComponent(file.name)}`)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    request.upload.addEventListener('progress', (progressEvent) => {
      if (!progressEvent.lengthComputable) return
      setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100))
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
          A transcription to convert instead of the scan, or a scan to keep beside the text. One
          file of each type — up to {MAX_UPLOAD_LABEL}. Adding one costs nothing and changes
          nothing until it is chosen.
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
  )
}
