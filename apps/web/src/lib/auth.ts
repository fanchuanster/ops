import config from '@payload-config'
import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'

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
