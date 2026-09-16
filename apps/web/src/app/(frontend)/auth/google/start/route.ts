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
  const next = safeNext(url.searchParams.get('next'))

  const response = NextResponse.redirect(
    buildAuthorizationUrl({ config, state, nonce, codeVerifier }),
  )

  const options = {
    httpOnly: true,
    secure: url.protocol === 'https:',
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
