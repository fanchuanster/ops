/**
 * Where Google sends the reader back.
 *
 * Exchanges the code, checks the claims, and issues a Payload session.
 * Every refusal ends at the login page with a message; none of them leak
 * whether an address has an account here.
 *
 * The decisions that matter are not made in this file. Claim validation
 * and account linking live in `domain/googleIdentity.ts` under test, and
 * turning a verified profile into a session is `lib/googleSession.ts`,
 * shared with One Tap. This handler is the redirect flow's transport and
 * nothing else.
 */

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

export const dynamic = 'force-dynamic'

/**
 * Expire the four round-trip cookies.
 *
 * Appends the headers by hand rather than calling `response.cookies.delete`.
 * `NextResponse.cookies` rebuilds the whole Set-Cookie header set from its
 * own parsed view of the response, and anything added with
 * `headers.append` is not in that view — so a single `delete` call silently
 * discards every appended cookie, including the session cookie this handler
 * exists to issue. Staying on one mechanism removes the ordering trap
 * instead of relying on getting the order right.
 */
function expireRoundTripCookies(response: NextResponse, secure: boolean) {
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    response.headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    )
  }
}

/** Send the reader back to the login page with something to read. */
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

  // The reader pressed "cancel" on Google's consent screen, or Google
  // refused. Not an error worth alarming them about.
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

  // Constant-time-ish comparison is unnecessary here — both values are
  // 256-bit random tokens and a timing oracle gains nothing — but the
  // check itself is what stops a cross-site request forging a login.
  if (returnedState !== expectedState) {
    return fail(origin, 'That sign-in could not be matched to your browser. Please try again.')
  }

  let claims: Record<string, unknown>
  try {
    const tokens = await exchangeCode({ config: oauth, code, codeVerifier })
    if (!tokens.id_token) throw new Error('no id_token in the token response')
    // Reading without verifying the signature is correct here and only
    // here: this token came straight from Google's token endpoint over
    // TLS and never touched the browser. One Tap receives its token from
    // the client and must check the signature — lib/googleIdToken.ts.
    claims = decodeIdTokenClaims(tokens.id_token)
  } catch {
    // The detail is deliberately not shown: it can carry the client
    // secret's error context and means nothing to a reader.
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

  const response = NextResponse.redirect(new URL(next, origin))
  response.headers.append('Set-Cookie', session.cookie)
  expireRoundTripCookies(response, url.protocol === 'https:')
  return response
}
