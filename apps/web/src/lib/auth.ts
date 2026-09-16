import config from '@payload-config'
import { headers as nextHeaders } from 'next/headers'
import { getPayload, type Payload } from 'payload'

import { logError } from './logError'

export async function getCurrentUser() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await nextHeaders() })
  return user ?? null
}

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

export function safeNext(next: string | undefined | null): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}
