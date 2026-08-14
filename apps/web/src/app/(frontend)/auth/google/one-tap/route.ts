/**
 * Google One Tap.
 *
 * The prompt Google shows in the corner of the page to a reader who is
 * already signed in to Google. Two methods, because the flow has two
 * halves and both need the server:
 *
 *   GET   mint a nonce, store it in an httpOnly cookie, hand the value
 *         to the browser so it can be put in the token request
 *   POST  receive the credential Google gave the browser, verify it, and
 *         set a session cookie
 *
 * The nonce is what makes the POST safe. Without it this endpoint would
 * accept any valid Google ID token from anywhere, which is a login-CSRF:
 * an attacker posts *their own* token and the victim's browser quietly
 * becomes signed in as the attacker, so anything the victim then does —
 * saving a Kindle address, reading progress — lands in an account the
 * attacker controls. Requiring a nonce that only this browser was given
 * closes that, since an attacker cannot read the victim's cookie.
 */

import { NextResponse } from 'next/server'

import { SIGN_IN_REFUSAL_MESSAGES, verifyGoogleClaims } from '../../../../../domain/googleIdentity'
import { getCurrentUser, safeNext } from '../../../../../lib/auth'
import { verifyGoogleIdTokenSignature } from '../../../../../lib/googleIdToken'
import { OAUTH_COOKIE_MAX_AGE, googleOAuthConfig, randomToken } from '../../../../../lib/googleOAuth'
import { sessionForGoogleProfile } from '../../../../../lib/googleSession'

export const dynamic = 'force-dynamic'

const ONE_TAP_NONCE_COOKIE = 'ns-google-onetap-nonce'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const config = googleOAuthConfig(url.origin)
  if (!config) return NextResponse.json({ enabled: false })

  // Never prompt someone who is already signed in.
  if (await getCurrentUser()) return NextResponse.json({ enabled: false })

  const nonce = randomToken()
  const response = NextResponse.json({ enabled: true, clientId: config.clientId, nonce })
  response.cookies.set(ONE_TAP_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  })
  return response
}

/**
 * Refuse, and say why in the log.
 *
 * The reader gets a deliberately vague message — a sign-in endpoint that
 * explains precisely which check failed is a sign-in endpoint that helps
 * an attacker tune their next attempt. The operator gets the reason, in
 * the Worker log, where debugging a flow that spans Google, a browser
 * and a Worker is otherwise guesswork. Reason codes only: no credential,
 * no address, nothing worth having if the logs leak.
 */
function refuse(reason: string, message: string, status: number) {
  console.warn(`one-tap refused: ${reason}`)
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin

  const config = googleOAuthConfig(origin)
  if (!config) return refuse('not_configured', 'Not configured.', 404)

  // A cross-site form post cannot set this header to our origin, and a
  // cross-site fetch that tries is stopped before it arrives. Belt and
  // braces alongside the nonce.
  const requestOrigin = request.headers.get('origin')
  if (requestOrigin && requestOrigin !== origin) {
    return refuse(`bad_origin:${requestOrigin}`, 'Bad origin.', 403)
  }

  let credential: unknown
  let next = '/'
  try {
    const body = (await request.json()) as { credential?: unknown; next?: unknown }
    credential = body.credential
    next = safeNext(typeof body.next === 'string' ? body.next : null)
  } catch {
    return refuse('unparseable_body', 'Bad request.', 400)
  }

  if (typeof credential !== 'string' || !credential) {
    return refuse('no_credential', 'Bad request.', 400)
  }

  const nonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ONE_TAP_NONCE_COOKIE}=`))
    ?.slice(ONE_TAP_NONCE_COOKIE.length + 1)

  if (!nonce) {
    return refuse(
      'no_nonce_cookie',
      'That sign-in could not be matched to your browser.',
      400,
    )
  }

  // The token came from the browser, so the signature is the only thing
  // establishing that Google issued it. See lib/googleIdToken.ts.
  let claims: Record<string, unknown>
  try {
    claims = await verifyGoogleIdTokenSignature(credential)
  } catch (error) {
    return refuse(
      `bad_signature:${(error as Error).message}`,
      'Google sign-in failed. Please try again.',
      400,
    )
  }

  const verified = verifyGoogleClaims({
    claims,
    clientId: config.clientId,
    nonce: decodeURIComponent(nonce),
    now: new Date(),
  })
  if (!verified.ok) {
    // The nonce is the check most likely to fail for a reason that is our
    // fault rather than an attack, so it is worth being able to tell the
    // difference in a log.
    return refuse(
      `claims:${verified.reason}`,
      SIGN_IN_REFUSAL_MESSAGES[verified.reason],
      403,
    )
  }

  const session = await sessionForGoogleProfile(verified.profile)
  if (!session.ok) {
    return refuse('session', session.message, 403)
  }

  const response = NextResponse.json({ ok: true, next })
  response.headers.append('Set-Cookie', session.cookie)
  // Appended by hand, not `cookies.delete` — that rebuilds the whole
  // Set-Cookie set from its own parsed view and drops appended headers,
  // which is exactly how the session cookie went missing before.
  response.headers.append(
    'Set-Cookie',
    `${ONE_TAP_NONCE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      url.protocol === 'https:' ? '; Secure' : ''
    }`,
  )
  return response
}
