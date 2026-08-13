'use server'

import config from '@payload-config'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { checkPassword } from '../../../domain/password'
import { safeNext } from '../../../lib/auth'

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
    ;(await cookies()).set(`${payload.config.cookiePrefix}-token`, result.token, COOKIE_OPTIONS)
  } catch {
    // Deliberately identical whether the address is unknown or the
    // password is wrong: distinguishing them tells an attacker which
    // email addresses have accounts.
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
  try {
    await payload.create({
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
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/duplicate|unique|already/i.test(message)) {
      return { error: 'An account with that email already exists.' }
    }
    return { error: 'Could not create the account. Check the address and try again.' }
  }

  const result = await payload.login({ collection: 'users', data: { email, password } })
  if (result.token) {
    ;(await cookies()).set(`${payload.config.cookiePrefix}-token`, result.token, COOKIE_OPTIONS)
  }

  redirect(next)
}

export async function logout() {
  const payload = await getPayload({ config })
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
  redirect('/')
}
