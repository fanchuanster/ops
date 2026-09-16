import { objectBucket } from './storage'
import { logError } from './logError'

export function avatarKey(userId: string | number): string {
  return `avatars/${userId}`
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const MAX_BYTES = 2 * 1024 * 1024

const FETCH_TIMEOUT_MS = 5000

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function localAvatarPath(sourceUrl: string): Promise<string> {
  return `/avatar?v=${await digest(sourceUrl)}`
}

export async function mirrorAvatar({
  userId,
  sourceUrl,
  currentAvatarUrl,
}: {
  userId: string | number
  sourceUrl: string
  currentAvatarUrl?: string | null
}): Promise<string | null> {
  try {
    const path = await localAvatarPath(sourceUrl)

    if (currentAvatarUrl === path) return path

    const bucket = await objectBucket()
    if (!bucket) return null

    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok || !response.body) return null

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
    if (!ALLOWED_TYPES.has(contentType)) return null

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null

    await bucket.put(avatarKey(userId), bytes, {
      httpMetadata: { contentType },
    })

    return path
  } catch (error) {
    logError('avatars: mirror avatar', error)
    return null
  }
}

export async function readAvatar(
  userId: string | number,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const bucket = await objectBucket()
  if (!bucket) return null

  const object = await bucket.get(avatarKey(userId))
  if (!object?.body) return null

  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType || 'application/octet-stream',
  }
}
