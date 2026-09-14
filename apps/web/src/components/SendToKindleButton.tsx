'use client'

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'

import { sendToKindle, type KindleState } from '../app/(frontend)/actions/kindle'
import { RESEND_PRICE } from '../domain/credits'
import {
  KINDLE_CONVERT_SUBJECT,
  MAX_ATTACHMENT_BYTES,
  describeBytes,
  isEmailableSize,
  tooLargeMessage,
} from '../domain/kindle'

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
 * The control is split: the button sends, and the caret beside it
 * offers the one variation worth having — a send whose subject line is
 * the word `Convert`, which is how Amazon is asked to run the file
 * through its own conversion rather than deliver it as it stands. That
 * is a second button rather than the default because it costs the
 * filename: the subject is Amazon's instruction slot, so a converted
 * delivery arrives without the book's name on it.
 *
 * What the page chooses to render is never what enforces anything: the
 * server action re-checks the address, the format, the rights, the
 * price and the reader's balance regardless.
 */
const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB — reflowable',
  pdf: 'PDF',
  txt: 'Plain text',
}

/**
 * A format the reader has, and how big it is.
 *
 * `bytes` is what the book recorded when the artifact was filed. It can
 * be missing on older records, and a missing size is treated as
 * sendable rather than as too large: the server weighs the real file
 * before spending anything, so the worst case is the refusal a reader
 * would have got anyway. Greying out a format we merely failed to
 * measure would hide a book that sends perfectly well.
 */
export type DeliverableFormat = { format: string; bytes?: number | null }

function oversized({ bytes }: DeliverableFormat): boolean {
  return typeof bytes === 'number' && bytes > 0 && !isEmailableSize(bytes)
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
  formats: DeliverableFormat[]
  /** What the first send costs. Zero for the reader's own upload. */
  price: number
  balance: number
}) {
  const [state, action, pending] = useActionState<KindleState, FormData>(sendToKindle, {})

  if (formats.length === 0) return null

  // Email cannot carry every book. Saying so before the click is worth
  // doing — the server refuses the same file for the same reason, but
  // only after fetching it out of R2, and a reader who has chosen a
  // format and pressed a button has already been told the book is
  // theirs to send.
  const sendable = formats.filter((f) => !oversized(f))

  if (sendable.length === 0) {
    // The smallest of them, not the first: it is the one that came
    // closest to fitting, so it is the honest measure of how far over
    // this book is. Every format here has a size — that is what
    // `oversized` needed to be sure.
    const smallest = Math.min(...formats.map((f) => f.bytes as number))

    return (
      <span className="send-hint" title={tooLargeMessage(smallest)}>
        Too large to email — {describeBytes(smallest)}, over the{' '}
        {describeBytes(MAX_ATTACHMENT_BYTES)} limit. Read it here instead.
      </span>
    )
  }

  // The action reports the balance it left behind; before the first
  // send, the page's figure is the current one.
  const currentBalance = state.balance ?? balance

  const label = pending
    ? 'Sending…'
    : state.sent
      ? // Which of the two sends it was, because they arrive
        // differently: a converted document appears in the Kindle
        // library under Amazon's own name for it rather than the
        // filename, and a reader who sees only "Sent" has no way to
        // tell whether the thing they asked for is what happened.
        state.converted
        ? 'Sent for conversion'
        : 'Sent'
      : price > 0
        ? `Send to Kindle — ${price} credit${price === 1 ? '' : 's'}`
        : 'Send to Kindle'

  // A repeat send costs a credit and must never be spent silently, so
  // the confirmation guards *both* buttons — the second one is another
  // delivery of the same book, charged identically. Returning false
  // means the caller prevents the click, which stops the submit event
  // ever firing and so keeps the form action from running. Doing it
  // from the button rather than the form's onSubmit avoids depending on
  // React honouring defaultPrevented for action props.
  const confirmed = () => !state.sent || window.confirm(resendWarning(currentBalance))

  return (
    <form action={action} className="send-to-kindle">
      <input type="hidden" name="bookId" value={String(bookId)} />

      {formats.length > 1 ? (
        // The default is EPUB where EPUB can actually be sent, and
        // otherwise the first format that can — never a disabled option,
        // which in a select is a form that cannot be submitted.
        <select
          name="format"
          defaultValue={sendable.some((f) => f.format === 'epub') ? 'epub' : sendable[0].format}
          aria-label="Format to send"
        >
          {formats.map((f) => (
            <option
              key={f.format}
              value={f.format}
              disabled={oversized(f)}
              // The limit is named in the label as well as the tooltip.
              // A `title` on an <option> is honoured by some browsers
              // and silently dropped by others, so the tooltip is the
              // fuller version of something already readable, never the
              // only place the limit is stated.
              title={oversized(f) ? tooLargeMessage(f.bytes as number) : undefined}
            >
              {FORMAT_LABEL[f.format] ?? f.format}
              {oversized(f)
                ? ` — ${describeBytes(f.bytes as number)}, over the ${describeBytes(
                    MAX_ATTACHMENT_BYTES,
                  )} email limit`
                : ''}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="format" value={formats[0].format} />
      )}

      <SplitSend
        label={label}
        sent={Boolean(state.sent)}
        pending={pending}
        confirmed={confirmed}
      />

      {/* Only failures get words. Success is the button itself. */}
      {state.error ? <span className="form-error">{state.error}</span> : null}
    </form>
  )
}

/**
 * The send button, and the menu of the one other way to send.
 *
 * Both are submit buttons inside the caller's form, which is what keeps
 * the format select and the book id in play for either one: the
 * submitter's own `name`/`value` is included in the FormData, so
 * "Send with Convert" is an ordinary send that additionally carries
 * `convert=1`. Nothing about the request shape differs, and an
 * ordinary click cannot ask for conversion by accident.
 *
 * The menu closes on Escape and on a press outside it, because a
 * dropdown that only closes by choosing something traps a reader who
 * opened it to look.
 */
function SplitSend({
  label,
  sent,
  pending,
  confirmed,
}: {
  label: string
  sent: boolean
  pending: boolean
  /** Asks about a repeat send; false means don't submit. */
  confirmed: () => boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    // `pointerdown` rather than `click`: closing on the press means the
    // menu is gone before a click lands on whatever is underneath,
    // which is what makes pressing elsewhere feel like dismissal rather
    // than a swallowed first click.
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const guard = (event: ReactMouseEvent) => {
    if (!confirmed()) event.preventDefault()
    setOpen(false)
  }

  return (
    <div className="send-split" ref={box}>
      <div className="send-split__pair">
        <button
          type="submit"
          disabled={pending}
          className={`send-to-kindle__button send-split__main${
            sent ? ' send-to-kindle__button--sent' : ''
          }`}
          onClick={guard}
        >
          {label}
        </button>

        <button
          type="button"
          disabled={pending}
          className={`send-to-kindle__button send-split__toggle${
            sent ? ' send-to-kindle__button--sent' : ''
          }`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Other ways to send"
          onClick={() => setOpen((was) => !was)}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>

      {open ? (
        <div className="send-split__menu" role="menu">
          <button
            type="submit"
            role="menuitem"
            name="convert"
            value="1"
            disabled={pending}
            className="send-split__item"
            onClick={guard}
          >
            Send with {KINDLE_CONVERT_SUBJECT}
            {/*
              Said here rather than in a tooltip, because the whole
              reason to pick this is a book that arrived in the wrong
              shape, and a reader in that position should not have to
              hover to find out what the option does — or discover
              afterwards that it took the title off the delivery.
            */}
            <span className="send-split__note">
              Asks Amazon to convert it to Kindle format. The subject line carries the instruction,
              so the book arrives without its filename.
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
