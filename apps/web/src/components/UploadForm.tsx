'use client'

import { useActionState, useState } from 'react'

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
 */
export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadBook, {})

  // Checked here as well as in the action, because the server's answer
  // to an oversized file costs the whole upload to hear. The action
  // still enforces it — this is courtesy, not the boundary.
  const [tooBig, setTooBig] = useState<string | null>(null)

  return (
    <form action={action} className="upload-form">
      <label>
        <span>File</span>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.docx,.epub,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/epub+zip,text/plain,text/markdown"
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0]
            setTooBig(
              chosen && chosen.size > MAX_UPLOAD_BYTES
                ? `That file is ${Math.round(chosen.size / 1024 / 1024)} MB — larger than the ${MAX_UPLOAD_LABEL} limit.`
                : null,
            )
          }}
        />
        <small>
          PDF (scanned or not), DOCX, EPUB, or plain text. Up to {MAX_UPLOAD_LABEL}.
        </small>
      </label>

      <button type="submit" className="button-quiet" disabled={pending || tooBig !== null}>
        {pending ? 'Reading your file…' : 'Upload'}
      </button>

      {tooBig ?? state.error ? <p className="form-error">{tooBig ?? state.error}</p> : null}
    </form>
  )
}
