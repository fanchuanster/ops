'use server'

import config from '@payload-config'
import { cookies, headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload, type Payload } from 'payload'

import { checkPassword } from '../../../domain/password'
import { accrueMonthlyCredits, grantSignupCredits } from '../../../lib/credits'
import { endSession, safeNext } from '../../../lib/auth'
import { logError } from '../../../lib/logError'

/**
 * Sign-up and log-in as server actions.
 *
 * Credentials never reach a client component, and the session cookie is
 * set server-side with the flags Payload expects. Failures come back as
 * a message to render rather than a thrown error, so a mistyped
 * password is an ordinary form response and not an error page.
 */

export type AuthState = { error?: string }

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: (process.env.NEXT_PUBLIC_SERVER_URL || '').startsWith('https://'),
  sameSite: 'lax' as const,
  path: '/',
}

/**
 * Store the session cookie, for as long as the token inside it is good
 * for.
 *
 * The lifetime is read off the collection (`collections/Users.ts`)
 * rather than written again here, so the cookie and the token can never
 * disagree about when the session ends. Payload's own cookie — the one
 * the Google flows get from `generatePayloadCookie` — has always been
 * derived that way, and this is the password flow doing the same.
 *
 * Without it the cookie has no expiry at all, which is not "forever"
 * but the opposite: a browser-session cookie, discarded when the window
 * closes. That is half of why readers kept being asked to sign in
 * again; the two-hour token was the other half.
 */
async function setSessionCookie(payload: Payload, token: string) {
  const { auth } = payload.collections['users']!.config
  ;(await cookies()).set(`${payload.config.cookiePrefix}-token`, token, {
    ...COOKIE_OPTIONS,
    maxAge: auth.tokenExpiration,
  })
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')
  const next = safeNext(String(formData.get('next') || ''))

  if (!email || !password) return { error: 'Enter your email and password.' }

  const payload = await getPayload({ config })
  try {
    const result = await payload.login({
      collection: 'users',
      data: { email, password },
    })
    if (!result.token) return { error: 'Email or password is incorrect.' }
    await setSessionCookie(payload, result.token)
    // Signing in is what pays the monthly grant — there is no cron.
    // Never throws, so a grant that cannot be recorded does not cost
    // the reader their session. See lib/credits.ts.
    if (result.user?.id) await accrueMonthlyCredits(payload, result.user.id)
  } catch (error) {
    // Logged but not shown. The reader's message is deliberately
    // identical whether the address is unknown or the password is
    // wrong — distinguishing them tells an attacker which email
    // addresses have accounts — which also makes a genuine outage here
    // indistinguishable from a typo unless the cause is written down.
    logError('signIn: authenticate', error)
    return { error: 'Email or password is incorrect.' }
  }

  redirect(next)
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')
  const displayName = String(formData.get('displayName') || '').trim()
  const next = safeNext(String(formData.get('next') || ''))

  if (!email) return { error: 'Enter an email address and a password.' }
  // The collection hook enforces this too; checking here as well turns a
  // thrown APIError into a message the form can render inline.
  const problem = checkPassword(password)
  if (problem) return { error: problem.message }

  const payload = await getPayload({ config })
  let createdId: string | number | undefined
  try {
    const created = await payload.create({
      collection: 'users',
      data: {
        email,
        password,
        displayName: displayName || undefined,
        // Readers cannot grant themselves anything else; the roles
        // field rejects self-promotion at the field level too.
        roles: ['reader'],
      },
      overrideAccess: true,
    })
    createdId = created.id
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/duplicate|unique|already/i.test(message)) {
      return { error: 'An account with that email already exists.' }
    }
    return { error: 'Could not create the account. Check the address and try again.' }
  }

  // The opening balance, and the accrual baseline that stops this
  // month also being paid later as a backdated absent one.
  if (createdId) await grantSignupCredits(payload, createdId)

  const result = await payload.login({ collection: 'users', data: { email, password } })
  if (result.token) await setSessionCookie(payload, result.token)

  redirect(next)
}

export async function logout() {
  const payload = await getPayload({ config })
  // Revoke the session, not just the cookie. The token names a row in
  // the user's `sessions` and Payload checks it on every request, so
  // deleting that row is what makes a copy of the token stop working —
  // which matters now that one is good for a year rather than two
  // hours. Only this session: signing out on one device leaves the
  // reader signed in on the others.
  const { user } = await payload.auth({ headers: await nextHeaders() })
  const sid = (user as { _sid?: string } | null)?._sid
  if (user && sid) await endSession(payload, user.id, sid)
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
  redirect('/')
}
