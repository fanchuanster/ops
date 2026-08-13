/**
 * Begins "Sign in with Google".
 *
 * Mints the three single-use secrets that bind the round trip together —
 * state (CSRF), nonce (token replay) and a PKCE verifier — stores them
 * in short-lived httpOnly cookies, and sends the reader to Google.
 *
 * A GET rather than a POST because it is a navigation, and it carries no
 * side effects beyond setting those cookies.
 */

import { NextResponse } from 'next/server'

import { safeNext } from '../../../../../lib/auth'
import {
  NEXT_COOKIE,
  NONCE_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  buildAuthorizationUrl,
  googleOAuthConfig,
  randomToken,
} from '../../../../../lib/googleOAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const config = googleOAuthConfig(url.origin)

  if (!config) {
    return NextResponse.redirect(new URL('/login?error=google_unavailable', url.origin))
  }

  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken()
  // Validated on the way in as well as on the way back: this value is
  // attacker-supplied and is about to be stored in a cookie.
  const next = safeNext(url.searchParams.get('next'))

  const response = NextResponse.redirect(
    buildAuthorizationUrl({ config, state, nonce, codeVerifier }),
  )

  const options = {
    httpOnly: true,
    // Derived from the actual request rather than an env var, so this is
    // right on localhost and in production without configuration.
    secure: url.protocol === 'https:',
    // `lax` and not `strict`: the reader returns here by a top-level
    // redirect from Google, and a strict cookie is not sent on that
    // navigation — the flow would fail every time.
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  }

  response.cookies.set(STATE_COOKIE, state, options)
  response.cookies.set(NONCE_COOKIE, nonce, options)
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, options)
  response.cookies.set(NEXT_COOKIE, next, options)

  return response
}
