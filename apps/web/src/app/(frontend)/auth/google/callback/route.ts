/**
 * Where Google sends the reader back.
 *
 * Exchanges the code, checks the claims, decides what the identity means
 * for our accounts, and issues a Payload session. Every refusal ends at
 * the login page with a message; none of them leak whether an address
 * has an account here.
 *
 * The two decisions that matter are not made in this file. Claim
 * validation and account linking live in `domain/googleIdentity.ts`
 * under test; this handler supplies them with data and acts on the
 * answer.
 */

import config from '@payload-config'
import { NextResponse } from 'next/server'
import { generatePayloadCookie, getFieldsToSign, getPayload, jwtSign } from 'payload'

import {
  SIGN_IN_REFUSAL_MESSAGES,
  decideGoogleSignIn,
  verifyGoogleClaims,
  type ExistingAccount,
  type GoogleProfile,
} from '../../../../../domain/googleIdentity'
import { safeNext } from '../../../../../lib/auth'
import {
  NEXT_COOKIE,
  NONCE_COOKIE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  decodeIdTokenClaims,
  exchangeCode,
  googleOAuthConfig,
  randomToken,
} from '../../../../../lib/googleOAuth'

export const dynamic = 'force-dynamic'

/** Send the reader back to the login page with something to read. */
function fail(origin: string, message: string) {
  const url = new URL('/login', origin)
  url.searchParams.set('error', message)
  const response = NextResponse.redirect(url)
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    response.cookies.delete(name)
  }
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

  const cookies = request.headers
  const cookieHeader = cookies.get('cookie') ?? ''
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

  const profile = verified.profile
  const payload = await getPayload({ config })

  const asAccount = (doc: { id: string | number; email: string; googleId?: string | null }) =>
    ({ id: doc.id, email: doc.email, googleId: doc.googleId ?? null }) as ExistingAccount

  const [linked, byEmail] = await Promise.all([
    payload.find({
      collection: 'users',
      where: { googleId: { equals: profile.googleId } },
      limit: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'users',
      where: { email: { equals: profile.email } },
      limit: 1,
      overrideAccess: true,
    }),
  ])

  const decision = decideGoogleSignIn({
    profile,
    byGoogleId: linked.docs[0] ? asAccount(linked.docs[0]) : null,
    byEmail: byEmail.docs[0] ? asAccount(byEmail.docs[0]) : null,
  })

  if (decision.action === 'refuse') {
    return fail(origin, SIGN_IN_REFUSAL_MESSAGES[decision.reason])
  }

  let userId: string | number
  try {
    if (decision.action === 'create') {
      userId = await createReader(payload, decision.profile)
    } else {
      userId = decision.accountId
      if (decision.action === 'link_and_sign_in') {
        await payload.update({
          collection: 'users',
          id: userId,
          data: { googleId: profile.googleId },
          overrideAccess: true,
        })
      }
    }
  } catch {
    return fail(origin, 'Could not complete the sign-in. Please try again.')
  }

  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    overrideAccess: true,
  })

  // Payload's own session, issued without a password — the reader has
  // just proved who they are to Google, which is the whole point.
  const collectionConfig = payload.collections['users'].config
  const fieldsToSign = getFieldsToSign({
    collectionConfig,
    email: user.email,
    user: { ...user, collection: 'users' } as never,
  })
  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: collectionConfig.auth.tokenExpiration,
  })

  const response = NextResponse.redirect(new URL(next, origin))
  response.headers.append(
    'Set-Cookie',
    generatePayloadCookie({
      collectionAuthConfig: collectionConfig.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token,
    }),
  )
  for (const name of [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    response.cookies.delete(name)
  }
  return response
}

/**
 * Create a reader for a Google identity.
 *
 * Payload's auth requires a password, and this reader does not have one.
 * A long random value is set rather than a blank or a known placeholder:
 * it is never shown to anyone and never used, so the account can only be
 * entered through Google — until the reader sets a real password through
 * password reset, which works because the address is verified.
 */
async function createReader(
  payload: Awaited<ReturnType<typeof getPayload>>,
  profile: GoogleProfile,
): Promise<string | number> {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: profile.email,
      password: randomToken(48),
      displayName: profile.displayName || undefined,
      googleId: profile.googleId,
      roles: ['reader'],
    },
    overrideAccess: true,
  })
  return created.id
}
