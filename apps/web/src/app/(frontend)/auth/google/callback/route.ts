import { NextResponse } from 'next/server'

import { SIGN_IN_REFUSAL_MESSAGES, verifyGoogleClaims } from '../../../../../domain/googleIdentity'
import { safeNext } from '../../../../../lib/auth'
import {
  NEXT_COOKIE,
  NONCE_COOKIE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  decodeIdTokenClaims,
  exchangeCode,
  googleOAuthConfig,
} from '../../../../../lib/googleOAuth'
import { sessionForGoogleProfile } from '../../../../../lib/googleSession'
import { logError } from '../../../../../lib/logError'

export const dynamic = 'force-dynamic'

function expireRoundTripCookies(response: NextResponse, secure: boolean) {
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    response.headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    )
  }
}

function fail(origin: string, message: string) {
  const url = new URL('/login', origin)
  url.searchParams.set('error', message)
  const response = NextResponse.redirect(url)
  expireRoundTripCookies(response, url.protocol === 'https:')
  return response
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin

  const oauth = googleOAuthConfig(origin)
  if (!oauth) return fail(origin, 'Google sign-in is not configured.')

  if (url.searchParams.get('error')) {
    return fail(origin, 'Google sign-in was cancelled.')
  }

  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')

  const cookieHeader = request.headers.get('cookie') ?? ''
  const jar = new Map(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=')
        return [part.slice(0, eq), decodeURIComponent(part.slice(eq + 1))] as const
      }),
  )

  const expectedState = jar.get(STATE_COOKIE)
  const nonce = jar.get(NONCE_COOKIE)
  const codeVerifier = jar.get(VERIFIER_COOKIE)
  const next = safeNext(jar.get(NEXT_COOKIE))

  if (!code || !returnedState || !expectedState || !nonce || !codeVerifier) {
    return fail(origin, 'That sign-in could not be completed. Please try again.')
  }

  if (returnedState !== expectedState) {
    return fail(origin, 'That sign-in could not be matched to your browser. Please try again.')
  }

  let claims: Record<string, unknown>
  try {
    const tokens = await exchangeCode({ config: oauth, code, codeVerifier })
    if (!tokens.id_token) throw new Error('no id_token in the token response')
    claims = decodeIdTokenClaims(tokens.id_token)
  } catch (error) {
    logError('googleCallback: exchange code', error)
    return fail(origin, 'Google sign-in failed. Please try again.')
  }

  const verified = verifyGoogleClaims({
    claims,
    clientId: oauth.clientId,
    nonce,
    now: new Date(),
  })
  if (!verified.ok) {
    return fail(origin, SIGN_IN_REFUSAL_MESSAGES[verified.reason])
  }

  const session = await sessionForGoogleProfile(verified.profile)
  if (!session.ok) return fail(origin, session.message)

  const response = handOff(new URL(next, origin).toString())
  response.headers.append('Set-Cookie', session.cookie)
  expireRoundTripCookies(response, url.protocol === 'https:')
  return response
}

function handOff(target: string): NextResponse {
  const attr = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const js = JSON.stringify(target).replace(/</g, '\\u003c')

  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Signing you in…</title>` +
      `<meta http-equiv="refresh" content="0;url=${attr}">` +
      `<p>Signing you in… <a href="${attr}">Continue</a></p>` +
      `<script>location.replace(${js})</script>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  )
}
