'use client'

import { useActionState } from 'react'

import { sendToKindle, type KindleState } from '../app/(frontend)/actions/kindle'
import { RESEND_PRICE } from '../domain/credits'

/**
 * Sends a book to the reader's Kindle.
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
 * price and the reader's balance regardless.
 */
const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB — reflowable',
  pdf: 'PDF',
}

/**
 * Shown before a repeat send.
 *
 * A resend costs credits — it is what replaced the rolling delivery cap
 * as the thing bounding how fast an account can pull the library — so
 * it must never be spent silently. Taking a credit without asking is
 * exactly the pattern this project rules out, and the reader who is
 * about to lose one is usually the one who clicked twice by accident.
 *
 * The price interpolates from the constant, so the sentence cannot
 * quietly start lying when the price changes.
 */
function resendWarning(balance: number | undefined): string {
  const cost = `${RESEND_PRICE} credit${RESEND_PRICE === 1 ? '' : 's'}`
  const have =
    typeof balance === 'number' ? ` You have ${balance} credit${balance === 1 ? '' : 's'}.` : ''

  return (
    `You have already sent this book.\n\n` +
    `Sending it again costs ${cost}.${have}\n\n` +
    `Send it again?`
  )
}

export function SendToKindleButton({
  bookId,
  formats,
  price,
  balance,
}: {
  bookId: string | number
  formats: string[]
  /** What the first send costs. Zero for the reader's own upload. */
  price: number
  balance: number
}) {
  const [state, action, pending] = useActionState<KindleState, FormData>(sendToKindle, {})

  if (formats.length === 0) return null

  // The action reports the balance it left behind; before the first
  // send, the page's figure is the current one.
  const currentBalance = state.balance ?? balance

  const label = pending
    ? 'Sending…'
    : state.sent
      ? 'Sent'
      : price > 0
        ? `Send to Kindle — ${price} credit${price === 1 ? '' : 's'}`
        : 'Send to Kindle'

  return (
    <form action={action} className="send-to-kindle">
      <input type="hidden" name="bookId" value={String(bookId)} />

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

      <button
        type="submit"
        disabled={pending}
        className={`send-to-kindle__button${state.sent ? ' send-to-kindle__button--sent' : ''}`}
        // Preventing the click's default stops the submit event ever
        // firing, which is what keeps the form action from running.
        // Doing this from the button rather than the form's onSubmit
        // avoids depending on React honouring defaultPrevented for
        // action props.
        onClick={(event) => {
          if (state.sent && !window.confirm(resendWarning(currentBalance))) {
            event.preventDefault()
          }
        }}
      >
        {label}
      </button>

      {/* Only failures get words. Success is the button itself. */}
      {state.error ? <span className="form-error">{state.error}</span> : null}
    </form>
  )
}
