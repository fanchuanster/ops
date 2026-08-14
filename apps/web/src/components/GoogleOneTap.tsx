'use client'

import { useEffect } from 'react'

/**
 * The Google One Tap prompt.
 *
 * A reader already signed in to Google sees "Continue as …" in the corner
 * and can be signed in without leaving the page. It is the one piece of
 * this flow that has to run in the browser: Google's library renders the
 * prompt and hands us a credential.
 *
 * Rendered only when nobody is signed in — the layout decides that — and
 * the endpoint checks again on the server, because a stale page is not a
 * reason to prompt someone who already has a session.
 *
 * Everything that matters still happens on the server. This component
 * receives a credential and posts it; it does not decide anything, and a
 * forged credential gets no further than the signature check.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: Record<string, unknown>) => void
          prompt: () => void
        }
      }
    }
  }
}

function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('GSI failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('GSI failed to load'))
    document.head.appendChild(script)
  })
}

/**
 * Where to send the reader once One Tap signs them in.
 *
 * Derived from the page they are on, not passed in, because the useful
 * answer is only known in the browser. The case that matters: a reader
 * asks for something that needs an account, gets sent to
 * `/login?next=/read/analects/1`, and accepts the prompt there — they
 * should land on the chapter they asked for, not on the home page having
 * forgotten why they signed in.
 *
 * Whatever this returns is still put through `safeNext` on the server,
 * so a crafted `next` cannot turn the prompt into an open redirect.
 */
function destination(): string {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('next')
  if (requested) return requested

  const { pathname, search } = window.location
  // Signing in *from* the sign-in page with nowhere in particular to go
  // means the reader came here deliberately; the library is the sensible
  // landing, and returning to /login would only bounce.
  if (pathname === '/login' || pathname === '/sign-up') return '/'
  return `${pathname}${search}`
}

export function GoogleOneTap() {
  useEffect(() => {
    let cancelled = false
    const next = destination()

    async function start() {
      try {
        // The nonce binds the credential to this browser, and the server
        // refuses a credential without it.
        const setup = await fetch('/auth/google/one-tap', { credentials: 'same-origin' })
        if (!setup.ok) return
        const { enabled, clientId, nonce } = (await setup.json()) as {
          enabled: boolean
          clientId?: string
          nonce?: string
        }
        if (cancelled || !enabled || !clientId || !nonce) return

        await loadGsi()
        if (cancelled || !window.google?.accounts?.id) return

        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return
            const result = await fetch('/auth/google/one-tap', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: response.credential, next }),
            })
            const body = (await result.json()) as { ok?: boolean; next?: string; message?: string }
            if (result.ok && body.ok) {
              // A full navigation rather than a router refresh: the session
              // arrived as a Set-Cookie header, and every server component
              // on the page was rendered for a signed-out reader.
              window.location.assign(body.next || next)
              return
            }
            // Not thrown and not shown to the reader — One Tap failing
            // should leave the page alone. But it must not fail silently
            // either: a prompt that appears, is accepted, and does
            // nothing is the hardest kind of bug to report.
            console.warn('[NobleSee] One Tap sign-in was refused:', body.message ?? result.status)
          },
          // Chrome has moved One Tap onto FedCM; without this the prompt
          // is silently suppressed in current versions.
          use_fedcm_for_prompt: true,
          // Do not dismiss the moment the reader clicks anywhere else —
          // a prompt that vanishes on the first stray click may as well
          // not have appeared.
          cancel_on_tap_outside: false,
          itp_support: true,
          context: 'signin',
        })

        window.google.accounts.id.prompt()
      } catch {
        // One Tap is a convenience. If Google's script is blocked, or the
        // reader has third-party prompts turned off, the ordinary sign-in
        // page is still right there and must not be disturbed by this.
      }
    }

    void start()
    return () => {
      cancelled = true
    }
    // Runs once per mount. The destination is read from the URL at that
    // moment, which is the moment the prompt is configured.
  }, [])

  return null
}
