'use server'

import config from '@payload-config'
import { cookies, headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload, type Payload } from 'payload'

import { checkPassword } from '../../../domain/password'
import { accrueMonthlyCredits, grantSignupCredits } from '../../../lib/credits'
import { endSession, safeNext } from '../../../lib/auth'
import { logError } from '../../../lib/logError'

export type AuthState = { error?: string }

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: (process.env.NEXT_PUBLIC_SERVER_URL || '').startsWith('https://'),
  sameSite: 'lax' as const,
  path: '/',
}

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
    if (result.user?.id) await accrueMonthlyCredits(payload, result.user.id)
  } catch (error) {
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

  if (createdId) await grantSignupCredits(payload, createdId)

  const result = await payload.login({ collection: 'users', data: { email, password } })
  if (result.token) await setSessionCookie(payload, result.token)

  redirect(next)
}

export async function logout() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  const sid = (user as { _sid?: string } | null)?._sid
  if (user && sid) await endSession(payload, user.id, sid)
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
  redirect('/')
}
