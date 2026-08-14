'use client'

import { useActionState } from 'react'

import { uploadBook, type UploadState } from '../app/(frontend)/actions/upload'
import { UPLOADER_RIGHTS } from '../domain/rights'

/**
 * The conversion portal's one form.
 *
 * Everything it collects is re-validated in the action — the file type,
 * the size, the rights answer, the collections. What the form is
 * genuinely for is asking the rights question at the only moment it is
 * easy to answer: while the uploader still has the file in front of
 * them and knows where it came from.
 *
 * Note what is *not* here. No visibility control, no reading level, no
 * "publish to the library" checkbox. Those are administrator fields
 * (CLAUDE.md section 6.1), and an uploader who could set them would
 * walk their upload straight into the front of the library.
 */
export function UploadForm({
  collections,
}: {
  collections: { id: number; title: string }[]
}) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadBook, {})

  return (
    <form action={action} className="upload-form">
      <label>
        <span>Title</span>
        <input type="text" name="title" required maxLength={200} />
      </label>

      <label>
        <span>Author</span>
        <input type="text" name="author" maxLength={200} />
      </label>

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

      <label>
        <span>Where did this come from?</span>
        <select name="rightsStatus" required defaultValue="user_owned">
          {UPLOADER_RIGHTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>
          Honest answers only. Owning a copy keeps the book private to you, which is the normal
          case and perfectly fine.
        </small>
      </label>

      {collections.length > 0 ? (
        <fieldset className="upload-form__collections">
          <legend>Collections</legend>
          <small>Where this book belongs, if it is ever published.</small>
          <div>
            {collections.map((collection) => (
              <label key={collection.id} className="upload-form__check">
                <input type="checkbox" name="collections" value={collection.id} />
                <span>{collection.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <button type="submit" className="button-quiet" disabled={pending}>
        {pending ? 'Uploading…' : 'Upload and convert'}
      </button>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}
