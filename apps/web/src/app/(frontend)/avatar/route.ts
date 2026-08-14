/**
 * The signed-in reader's own profile picture.
 *
 * Takes no id on purpose. The avatar is only ever shown to the reader
 * it belongs to, so "whose?" is answered by the session rather than by
 * the URL — which leaves nothing to enumerate and no access rule to get
 * wrong. If avatars ever appear next to someone else's name, this needs
 * a different shape and a deliberate decision about who may see whom.
 *
 * Cached hard and privately. The `v` query is a digest of the source
 * picture (see lib/avatars.ts), so a new picture is a new URL and this
 * response can never go stale; `private` keeps it out of any shared
 * cache, because it is one reader's face behind their session.
 */

import { getCurrentUser } from '../../../lib/auth'
import { readAvatar } from '../../../lib/avatars'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 401 })

  const avatar = await readAvatar(user.id)
  if (!avatar) return new Response(null, { status: 404 })

  return new Response(avatar.body, {
    headers: {
      'Content-Type': avatar.contentType,
      'Cache-Control': 'private, max-age=604800, immutable',
    },
  })
}
