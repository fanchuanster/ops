'use client'

import { useActionState } from 'react'

import { uploadBook, type UploadState } from '../app/(frontend)/actions/upload'

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

  return (
    <form action={action} className="upload-form">
      <label>
        <span>File</span>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        />
        <small>PDF (scanned or not), DOCX, or plain text. Up to 64 MB.</small>
      </label>

      <button type="submit" className="button-quiet" disabled={pending}>
        {pending ? 'Reading your file…' : 'Upload'}
      </button>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
