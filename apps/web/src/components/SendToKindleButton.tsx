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
import { KINDLE_CONVERT_SUBJECT } from '../domain/kindle'

const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB — reflowable',
  pdf: 'PDF',
  txt: 'Plain text',
}

export type DeliverableFormat = { format: string; bytes?: number | null }

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
  price: number
  balance: number
}) {
  const [state, action, pending] = useActionState<KindleState, FormData>(sendToKindle, {})

  if (formats.length === 0) return null

  const currentBalance = state.balance ?? balance

  const label = pending
    ? 'Sending…'
    : state.sent
      ?
        state.converted
        ? 'Sent for conversion'
        : 'Sent'
      : price > 0
        ? `Send to Kindle — ${price} credit${price === 1 ? '' : 's'}`
        : 'Send to Kindle'

  const confirmed = () => !state.sent || window.confirm(resendWarning(currentBalance))

  return (
    <form action={action} className="send-to-kindle">
      <input type="hidden" name="bookId" value={String(bookId)} />

      {formats.length > 1 ? (
        <select
          name="format"
          defaultValue={formats.some((f) => f.format === 'epub') ? 'epub' : formats[0].format}
          aria-label="Format to send"
        >
          {formats.map((f) => (
            <option key={f.format} value={f.format}>
              {FORMAT_LABEL[f.format] ?? f.format}
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

      {state.error ? <span className="form-error">{state.error}</span> : null}
    </form>
  )
}

function SplitSend({
  label,
  sent,
  pending,
  confirmed,
}: {
  label: string
  sent: boolean
  pending: boolean
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
