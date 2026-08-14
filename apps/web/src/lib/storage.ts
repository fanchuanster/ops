/**
 * Access to book artifacts in object storage.
 *
 * Book artifacts are NOT Payload media. They are large, access-
 * controlled files addressed by an explicit `storageKey`, reached only
 * after the server has authorized the request — never through a public
 * media URL. Hence a client of our own rather than the storage plugin's.
 *
 * Delivery is by streaming the object through this Worker.
 *
 * The previous implementation issued a short-lived S3 presigned URL so
 * the bytes came straight from R2's edge. The R2 *binding* has no
 * equivalent — presigning is an S3-API feature — so that is gone, and
 * it is a fair trade. Streaming keeps the bucket private with no
 * credential anywhere in the environment, it removes the window in
 * which a leaked URL outlives the authorization decision behind it, and
 * it costs a Worker almost nothing: piping a response body is I/O, and
 * Workers are billed and limited on CPU time, not wall clock.
 *
 * A local-disk path remains for running without Cloudflare at all.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The bucket itself.
 *
 * Exported because artifacts are not the only thing that lives in it —
 * mirrored avatars (`lib/avatars.ts`) need `put` and the object's
 * content type, neither of which the artifact helpers below expose.
 * Everything reaching for this still goes through a module that owns
 * one kind of object; nothing calls it from a route handler.
 */
export async function objectBucket(): Promise<R2Bucket | null> {
  return artifactBucket()
}

async function artifactBucket(): Promise<R2Bucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    return env.ARTIFACTS ?? null
  } catch {
    // Not running on (or against) Cloudflare — the local-disk path
    // below is the fallback, so this is not an error worth raising.
    return null
  }
}

export async function isObjectStorageConfigured(): Promise<boolean> {
  return (await artifactBucket()) !== null
}

/**
 * The artifact's bytes.
 *
 * Used both for downloads and by the in-browser reader. The reader in
 * particular needs this rather than a redirect to storage: epub.js
 * fetches ranges with XHR, and a cross-origin URL would need CORS
 * opened up on the bucket. Streaming from our own origin keeps the
 * request authenticated by the session cookie it already carries.
 */
export async function artifactStream(storageKey: string): Promise<ReadableStream | null> {
  const bucket = await artifactBucket()
  if (!bucket) return null
  const object = await bucket.get(storageKey)
  return object?.body ?? null
}

/**
 * The artifact's bytes, whole, in memory.
 *
 * Only for Kindle delivery, which has to base64 the file into a JSON
 * body and therefore cannot stream. Everything reader-facing should
 * keep using `artifactStream`: holding a book in memory is exactly what
 * the streaming path exists to avoid, and the size guard in
 * `isEmailableSize` is what stops this being unbounded.
 */
export async function artifactBytes(storageKey: string): Promise<Uint8Array | null> {
  const bucket = await artifactBucket()
  if (bucket) {
    const object = await bucket.get(storageKey)
    if (!object) return null
    return new Uint8Array(await object.arrayBuffer())
  }

  const filePath = localArtifactPath(storageKey)
  if (!filePath) return null
  const { readFile } = await import('node:fs/promises')
  return new Uint8Array(await readFile(filePath))
}

/**
 * Local-disk fallback, for development without Cloudflare.
 *
 * The path is rebuilt from its segments and checked to stay under the
 * content root, so a storageKey containing `..` cannot walk out of it.
 */
export function localArtifactPath(storageKey: string): string | null {
  const root = path.resolve(process.env.LOCAL_ARTIFACT_ROOT || '/app/content')
  const candidate = path.resolve(root, storageKey)
  if (!candidate.startsWith(root + path.sep)) return null
  return existsSync(candidate) ? candidate : null
}

export function streamLocalArtifact(filePath: string): ReadableStream {
  const nodeStream = createReadStream(filePath)
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)))
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (error) => controller.error(error))
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}
