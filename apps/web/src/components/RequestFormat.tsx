'use client'

import { useActionState } from 'react'

import { requestFormat } from '../app/(frontend)/actions/manageBook'
import type { ManageState } from '../app/(frontend)/actions/manageBook'
import { ON_DEMAND_FORMATS } from '../domain/pipeline'

const LABEL: Record<string, string> = {
  pdf_standard: 'Standard',
  pdf_large: 'Large',
  pdf_xl: 'Extra Large',
}

/**
 * Asking for one of the PDF sizes to be rendered.
 *
 * The three variants are three renderings of the same book, and most
 * readers want none of them — the EPUB is the reflowable edition and
 * the point of the project. So they are built when somebody asks, and
 * what gets built is the one size they asked for.
 *
 * Nothing happens inline. The request is recorded and the converter
 * picks it up on its next poll, which is why this says "we will build
 * it" rather than pretending to hand over a file.
 */
export function RequestFormat({
  bookId,
  existingFormats,
  pendingFormats,
}: {
  bookId: number
  existingFormats: readonly string[]
  pendingFormats: readonly string[]
}) {
  const [state, action, submitting] = useActionState<ManageState, FormData>(requestFormat, {})

  const missing = ON_DEMAND_FORMATS.filter((format) => !existingFormats.includes(format))
  if (missing.length === 0) return null

  return (
    <section className="request-format">
      <h3>Need a PDF?</h3>
      <p className="hint">
        The EPUB is the one to read — it reflows to your screen and your font size. A PDF is fixed
        typography, useful for printing or for a device that wants one. Pick a size and we will
        build it; it takes a few minutes.
      </p>

      <form action={action}>
        <input type="hidden" name="bookId" value={bookId} />
        {missing.map((format) => {
          const queued = pendingFormats.includes(format)
          return (
            <button
              key={format}
              type="submit"
              name="format"
              value={format}
              className="button-quiet"
              disabled={submitting || queued}
            >
              {queued ? `${LABEL[format]} — building…` : LABEL[format]}
            </button>
          )
        })}
      </form>

      {state.error ? <p className="form-error">{state.error}</p> : null}
    </section>
  )
}
