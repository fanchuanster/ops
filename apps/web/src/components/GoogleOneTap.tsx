'use client'

import { useEffect } from 'react'

import { logWarn } from '../lib/logError'

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

function destination(): string {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('next')
  if (requested) return requested

  const { pathname, search } = window.location
  if (pathname === '/login' || pathname === '/sign-up') return '/'
  return `${pathname}${search}`
}

export function GoogleOneTap() {
  useEffect(() => {
    let cancelled = false
    const next = destination()

    async function start() {
      try {
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
              window.location.assign(body.next || next)
              return
            }
            logWarn('auth.google.one-tap', body.message ?? result.status)
          },
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          itp_support: true,
          context: 'signin',
        })

        window.google.accounts.id.prompt()
      } catch {
      }
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
