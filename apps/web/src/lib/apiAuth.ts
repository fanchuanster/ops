import config from '@payload-config'
import { getPayload } from 'payload'
import type { Payload, TypedUser } from 'payload'

import { isAdmin } from './adminAuth'

/**
 * Who is calling the admin API, if anyone.
 *
 * `payload.auth` is given the request's own headers rather than
 * `next/headers`, which is the whole difference between this and
 * `lib/auth.ts`. That function answers "who is browsing"; this answers
 * "who sent this request", and the two are only the same when a browser
 * sent it. Passing the request's headers is what lets an
 * `Authorization: users API-Key …` header authenticate at all — a
 * script has no cookie to read.
 *
 * Both credentials work, and neither is special-cased here: Payload
 * resolves an API key and a session cookie to the same user object, so
 * a curl call and a logged-in editor's browser reach the endpoint by
 * the same path and are held to the same rules.
 *
 * Returns the payload client alongside the user because every caller
 * needs both and getting the client twice would open a second
 * connection for no reason.
 */
export async function adminFromRequest(
  request: Request,
): Promise<{ payload: Payload; admin: TypedUser | null }> {
  const payload = await getPayload({ config })
  try {
    const { user } = await payload.auth({ headers: request.headers })
    return { payload, admin: user && isAdmin(user) ? user : null }
  } catch {
    // A malformed or expired credential. Indistinguishable from none at
    // all as far as the caller is concerned, and deliberately so.
    return { payload, admin: null }
  }
}

/**
 * The one refusal this API gives for "not you".
 *
 * 401 and not 403, and the same body whether the credential was absent,
 * expired, or belonged to a reader. Telling an unauthenticated caller
 * that their key is valid but insufficient confirms the key is real,
 * which is a fact worth not confirming.
 */
export function unauthorized(): Response {
  return Response.json(
    { error: 'An administrator API key is required.' },
    { status: 401, headers: { 'WWW-Authenticate': 'API-Key' } },
  )
}
