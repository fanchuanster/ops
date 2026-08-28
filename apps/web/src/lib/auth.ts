import config from '@payload-config'
import { headers as nextHeaders } from 'next/headers'
import { getPayload, type Payload } from 'payload'

import { logError } from './logError'

/**
 * The signed-in reader, or null.
 *
 * Payload owns identity — sessions, hashing, password reset — while the
 * domain layer keys off a user id alone and never sees a Payload user
 * object. That boundary is what would let identity move elsewhere later
 * without touching a single business rule.
 */
export async function getCurrentUser() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  return user ?? null
}

/**
 * End one session — the device signing out, not every device.
 *
 * Payload authenticates against the `sessions` row a token names, not
 * the signature alone, so deleting that row is what actually stops the
 * token. Dropping the cookie only stops the browser that is holding it
 * politely; a session now lasts a year (`collections/Users.ts`), which
 * is far too long for "signed out" to mean nothing more than that.
 *
 * Payload's own logout operation is the same three lines, but it is
 * only reachable through the REST endpoint, which would mean the
 * application making an HTTP request to itself to sign a reader out.
 *
 * Never throws: a reader pressing "sign out" gets their cookie
 * dropped whatever the database says.
 */
export async function endSession(payload: Payload, userId: string | number, sid: string) {
  try {
    const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })
    const remaining = (user.sessions ?? []).filter((session) => session.id !== sid)
    if (remaining.length === (user.sessions ?? []).length) return
    await payload.update({
      collection: 'users',
      id: userId,
      data: { sessions: remaining },
      overrideAccess: true,
    })
  } catch (error) {
    logError('endSession: revoke session', error)
  }
}

/**
 * `next` is a post-login redirect target supplied by the client, so it
 * is only ever honoured as a path on this site. An absolute URL — or a
 * protocol-relative `//evil.example` — would turn the login form into
 * an open redirect.
 */
export function safeNext(next: string | undefined | null): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}
