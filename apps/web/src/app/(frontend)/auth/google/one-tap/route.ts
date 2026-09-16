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

function refuse(reason: string, message: string, status: number) {
  console.warn(`one-tap refused: ${reason}`)
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin

  const config = googleOAuthConfig(origin)
  if (!config) return refuse('not_configured', 'Not configured.', 404)

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
  response.headers.append(
    'Set-Cookie',
    `${ONE_TAP_NONCE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      url.protocol === 'https:' ? '; Secure' : ''
    }`,
  )
  return response
}
