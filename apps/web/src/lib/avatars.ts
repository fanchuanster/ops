/**
 * Mirroring a reader's Google profile picture into our own bucket.
 *
 * Hotlinking the picture from googleusercontent.com would mean the
 * reader's browser calls Google on every page they load while signed
 * in, which tells Google what they are reading here and when. That is
 * a poor trade for a 28px circle, and a strange one for a project whose
 * rule about third parties is the one in CLAUDE.md section 6.
 *
 * So the picture is fetched **once, server-side, at sign-in** and
 * stored in R2. The reader's browser only ever talks to us.
 *
 * The stored `avatarUrl` therefore holds *our* path — `/avatar?v=…` —
 * rather than Google's URL. Two consequences worth knowing:
 *
 *   - The route serves the signed-in reader their own avatar and takes
 *     no id, so there is nothing to enumerate and no access rule beyond
 *     "you are signed in".
 *   - The `v` is a digest of the source URL. Google changes that URL
 *     when the reader changes their picture, so a changed picture is a
 *     changed path — which is what lets the response be cached hard
 *     without ever going stale.
 */

import { objectBucket } from './storage'
import { logError } from './logError'

/** Where a reader's mirrored avatar lives. */
export function avatarKey(userId: string | number): string {
  return `avatars/${userId}`
}

/**
 * Formats we are willing to re-serve.
 *
 * An allowlist rather than a check for `image/`: `image/svg+xml` is a
 * document that can carry script, and we would be serving it from our
 * own origin.
 */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** Profile pictures are small; anything this big is not one. */
const MAX_BYTES = 2 * 1024 * 1024

const FETCH_TIMEOUT_MS = 5000

/** Short, stable, and enough to tell two Google URLs apart. */
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The path we store and render, for a given source picture. */
async function localAvatarPath(sourceUrl: string): Promise<string> {
  return `/avatar?v=${await digest(sourceUrl)}`
}

/**
 * Copy `sourceUrl` into R2 and return the path to serve it from.
 *
 * Returns null when there is nothing usable — no bucket, a fetch that
 * failed, a response that is not an image we accept, or one too large.
 * Null means "no picture", and the caller falls back to initials.
 *
 * This must never throw. It runs inside sign-in, and a reader whose
 * profile picture happens to 500 still needs to be able to sign in.
 */
export async function mirrorAvatar({
  userId,
  sourceUrl,
  currentAvatarUrl,
}: {
  userId: string | number
  sourceUrl: string
  /** What we already stored, so an unchanged picture is not refetched. */
  currentAvatarUrl?: string | null
}): Promise<string | null> {
  try {
    const path = await localAvatarPath(sourceUrl)

    // Same picture as last time. Signing in happens far more often than
    // changing your profile photo, so this is the common case and it
    // costs one hash rather than a round trip to Google.
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

    // Content-Length is advisory — a lying or absent header must not let
    // an unbounded body through — so the real cap is on the bytes we
    // actually read. Reading to completion is safe because of it.
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null

    await bucket.put(avatarKey(userId), bytes, {
      httpMetadata: { contentType },
    })

    return path
  } catch (error) {
    // Timeouts, DNS failures, a bucket that refused the write. None of
    // them are a reason to fail the sign-in that triggered this.
    logError('avatars: mirror avatar', error)
    return null
  }
}

/** The stored bytes, for the route that serves them. */
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
