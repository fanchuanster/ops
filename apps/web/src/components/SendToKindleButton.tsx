'use client'

import { useActionState } from 'react'

import { sendToKindle, type KindleState } from '../app/(frontend)/actions/kindle'

/**
 * Sends one part to the reader's Kindle.
 *
 * This is the only way a book leaves the site. There are no download
 * links: NobleSee gives you a book to read — in the reader, or on your
 * device — rather than a file to collect.
 *
 * EPUB is the default and is listed first because Amazon converts it to
 * the native format and it stays reflowable. The PDFs are offered
 * because some readers want them, but they arrive fixed-layout, which
 * is the thing this project exists to move away from.
 *
 * What the page chooses to render is never what enforces anything: the
 * server action re-checks the address, the format, the rights, the
 * staged release and the limit regardless.
 */
const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB — reflowable',
  pdf_standard: 'PDF — Standard',
  pdf_large: 'PDF — Large',
  pdf_xl: 'PDF — Extra Large',
}

export function SendToKindleButton({
  partId,
  formats,
}: {
  partId: string | number
  formats: string[]
}) {
  const [state, action, pending] = useActionState<KindleState, FormData>(sendToKindle, {})

  if (formats.length === 0) return null

  return (
    <form action={action} className="send-to-kindle">
      <input type="hidden" name="partId" value={String(partId)} />

      {formats.length > 1 ? (
        <select name="format" defaultValue="epub" aria-label="Format to send">
          {formats.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f] ?? f}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="format" value={formats[0]} />
      )}

      <button type="submit" disabled={pending} className="send-to-kindle__button">
        {pending ? 'Sending…' : 'Send to Kindle'}
      </button>

      {state.error ? <span className="form-error">{state.error}</span> : null}
      {state.notice ? <span className="form-notice">{state.notice}</span> : null}
    </form>
  )
}
