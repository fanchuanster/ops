import config from '@payload-config'
import { getPayload } from 'payload'
import type { Payload, TypedUser } from 'payload'

import { isAdmin } from './adminAuth'

export async function adminFromRequest(
  request: Request,
): Promise<{ payload: Payload; admin: TypedUser | null }> {
  const payload = await getPayload({ config })
  try {
    const { user } = await payload.auth({ headers: request.headers })
    return { payload, admin: user && isAdmin(user) ? user : null }
  } catch {
    return { payload, admin: null }
  }
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'An administrator API key is required.' },
    { status: 401, headers: { 'WWW-Authenticate': 'API-Key' } },
  )
}
