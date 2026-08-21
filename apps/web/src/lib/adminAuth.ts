import { redirect } from 'next/navigation'
import type { TypedUser } from 'payload'

import { getCurrentUser } from './auth'

/**
 * Who may use the editorial admin.
 *
 * One predicate, in one place, so "is this person an administrator"
 * cannot come to mean two slightly different things in two files. The
 * shape it reads — `roles` containing `admin` — is the same one the
 * Users collection's own access rules use.
 */
export function isAdmin(user: { roles?: (string | null)[] | null } | null): boolean {
  return Boolean(user?.roles?.includes('admin'))
}

/**
 * The signed-in administrator, or no page at all.
 *
 * Every admin page calls this, *and* every admin server action calls
 * it. That is not belt-and-braces: a layout guard protects rendering
 * and nothing else, and a server action is a POST endpoint that the
 * layout never runs for. An action trusting the layout would be an
 * unauthenticated write with a guard drawn around the wrong thing.
 *
 * A signed-out visitor is sent to log in and comes back; a signed-in
 * reader who is not an administrator is sent home rather than told that
 * an admin area exists and they are not in it.
 */
export async function requireAdmin(next = '/admin'): Promise<TypedUser> {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  if (!isAdmin(user)) redirect('/')
  return user
}

/**
 * The same check for a server action, which cannot redirect usefully.
 *
 * Returns null instead, so the caller can answer with an error the form
 * can render. Actions must never assume the page guard ran.
 */
export async function currentAdmin(): Promise<TypedUser | null> {
  const user = await getCurrentUser()
  return isAdmin(user) ? user : null
}
