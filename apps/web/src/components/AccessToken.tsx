'use client'

import { useActionState, useState } from 'react'

import { createToken, revokeToken, type TokenState } from '../app/(frontend)/actions/tokens'
import { maskToken } from '../domain/tokens'

/**
 * A reader's personal access token: what they have, and the two things
 * they can do about it.
 *
 * The token is masked until asked for. Not because the page cannot show
 * it — it is the owner's own secret over their own session — but
 * because this screen is the one someone opens while screen-sharing to
 * ask why their script stopped working, and a secret that is only
 * revealed deliberately cannot be revealed accidentally.
 *
 * Revoking asks first. It is the one irreversible control here: the
 * value is overwritten rather than archived, so a mis-click cannot be
 * walked back and every script holding it breaks at once.
 */
export function AccessToken({ current }: { current: string | null }) {
  const [created, createAction, creating] = useActionState<TokenState, FormData>(createToken, {})
  const [revoked, revokeAction, revoking] = useActionState<TokenState, FormData>(revokeToken, {})
  const [shown, setShown] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  // What the server last returned outranks what the page was rendered
  // with, so the panel is right immediately after an action instead of
  // waiting on revalidation.
  const token = revoked.notice ? null : (created.token ?? current)
  const state = created.token ? created : revoked

  async function copy() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // A browser that refuses the clipboard (no permission, no secure
      // context) leaves the reader with the reveal-and-select path,
      // which is why Show exists independently of Copy.
      setShown(true)
    }
  }

  return (
    <div className="access-token">
      {token ? (
        <>
          <p className="access-token__value">
            <code>{shown ? token : maskToken(token)}</code>
          </p>

          <div className="access-token__controls">
            <button type="button" className="button-quiet" onClick={() => setShown(!shown)}>
              {shown ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="button-quiet" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>

            <form action={createAction}>
              <button type="submit" className="button-quiet" disabled={creating}>
                {creating ? 'Replacing…' : 'Replace'}
              </button>
            </form>

            {confirming ? (
              <form action={revokeAction}>
                <button type="submit" className="button-quiet button-quiet--danger" disabled={revoking}>
                  {revoking ? 'Revoking…' : 'Yes, revoke it'}
                </button>
                <button type="button" className="button-quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="button-quiet button-quiet--danger"
                onClick={() => setConfirming(true)}
              >
                Revoke
              </button>
            )}
          </div>

          {confirming ? (
            <p className="hint">
              Revoking cannot be undone. Anything using this token stops working
              immediately.
            </p>
          ) : null}
        </>
      ) : (
        <form action={createAction}>
          <p className="empty">You have no token yet.</p>
          <button type="submit" className="cta" disabled={creating}>
            {creating ? 'Creating…' : 'Create a token'}
          </button>
        </form>
      )}

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.notice ? <p className="form-notice">{state.notice}</p> : null}
    </div>
  )
}
