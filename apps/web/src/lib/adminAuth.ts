import { redirect } from 'next/navigation'
import type { TypedUser } from 'payload'

import { getCurrentUser } from './auth'

export function isAdmin(user: { roles?: (string | null)[] | null } | null): boolean {
  return Boolean(user?.roles?.includes('admin'))
}

export async function requireAdmin(next = '/admin'): Promise<TypedUser> {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  if (!isAdmin(user)) redirect('/')
  return user
}

export async function currentAdmin(): Promise<TypedUser | null> {
  const user = await getCurrentUser()
  return isAdmin(user) ? user : null
}
