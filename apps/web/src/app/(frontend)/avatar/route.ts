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
