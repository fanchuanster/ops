'use client'

import { useActionState } from 'react'

import { saveKindleAddress, type KindleState } from '../app/(frontend)/actions/kindle'
import { KINDLE_SENDER_ADDRESS } from '../domain/kindle'

/**
 * Where a reader turns Kindle delivery on.
 *
 * The Amazon approved-sender step is given the same weight as the
 * address field rather than tucked into small print, because skipping
 * it produces the worst possible failure: Amazon accepts the message,
 * discards it silently, and the reader waits for a book that is never
 * going to arrive. There is no bounce and no error to show them, so the
 * only place this can be prevented is here, before they press send.
 */
export function KindleSettings({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<KindleState, FormData>(saveKindleAddress, {})

  return (
    <section className="kindle-settings">
      <div className="section-head">
        <h2>Send to Kindle</h2>
      </div>

      {current ? (
        <p>
          Delivering to <strong>{current}</strong>.
        </p>
      ) : (
        <p className="empty">
          Add your Kindle address to send books straight to your device.
        </p>
      )}

      <ol className="kindle-steps">
        <li>
          In Amazon, open <strong>Manage Your Content and Devices → Preferences →
          Personal Document Settings</strong>, and add{' '}
          <strong>{KINDLE_SENDER_ADDRESS}</strong> to your{' '}
          <strong>Approved Personal Document E-mail List</strong>.
          <span className="hint">
            Without this Amazon silently discards anything we send — no bounce, no error,
            the book simply never arrives.
          </span>
        </li>
        <li>
          On the same page, copy your <strong>Send-to-Kindle E-Mail Address</strong> — it ends
          in <code>@kindle.com</code> — and paste it below.
        </li>
      </ol>

      <form action={action}>
        <label>
          Kindle address
          <input
            name="kindleEmail"
            type="email"
            defaultValue={current ?? ''}
            placeholder="your-name_abc123@kindle.com"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {state.error ? <p className="form-error">{state.error}</p> : null}
        {state.notice ? <p className="form-notice">{state.notice}</p> : null}

        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : current ? 'Update address' : 'Enable delivery'}
        </button>
        {current ? (
          <p className="hint">Clear the field and save to turn delivery off.</p>
        ) : null}
      </form>
    </section>
  )
}
