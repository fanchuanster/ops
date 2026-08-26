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
import { logError } from './logError'

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

/**
 * Copy an object within the bucket, streaming.
 *
 * Streamed rather than read-then-write because the thing being copied is
 * an uploaded book — up to 64 MB — and a Worker has 128 MB of memory for
 * everything. Holding the whole file as a `Uint8Array` to hand it
 * straight back to `put` is the one avoidable way that budget gets
 * spent.
 *
 * Returns the size copied, or null if the source was not there.
 */
export async function copyObject(
  from: string,
  to: string,
  contentType?: string,
): Promise<number | null> {
  const bucket = await objectBucket()
  if (!bucket) return null

  const object = await bucket.get(from)
  if (!object) return null

  await bucket.put(to, object.body, {
    httpMetadata: { contentType: contentType ?? object.httpMetadata?.contentType },
  })
  return object.size
}

/**
 * Remove objects, best effort.
 *
 * Used when a reader deletes their own upload. Failures are swallowed:
 * an orphaned object costs a fraction of a penny, and refusing to
 * delete the book because its files would not go would leave the reader
 * unable to clear their own workspace over something they cannot see or
 * fix.
 */
export async function deleteObjects(keys: readonly string[]): Promise<void> {
  const bucket = await artifactBucket()
  if (!bucket || keys.length === 0) return
  try {
    await bucket.delete([...keys])
  } catch (error) {
    // Still not worth failing the caller over — but an object that
    // outlives the book it belonged to is a bill nobody notices.
    logError('storage: delete objects', error)
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
 * Write an artifact the conversion pipeline has just built.
 *
 * The counterpart to `artifactBytes`, and used by the same caller for
 * the same reason: a generated DOCX or EPUB is assembled in memory, so
 * there is nothing to stream from. The size guard is the builder's —
 * what these produce is text, and a book's text is orders of magnitude
 * smaller than the scan it came from.
 *
 * Returns false when there is no bucket, so a caller running without
 * Cloudflare fails the job rather than reporting a key nothing wrote.
 */
export async function putObject(
  storageKey: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const bucket = await artifactBucket()
  if (!bucket) return false
  await bucket.put(storageKey, bytes, { httpMetadata: { contentType } })
  return true
}

/**
 * A slice of an object, without fetching the object.
 *
 * What metadata extraction reads an upload through. The file is in R2
 * by then — streamed there without ever being resident — so the only
 * way to look at its first and last few hundred kilobytes is to ask for
 * exactly those. `bucket.get` with a range does that at the storage
 * layer, so a 100 MB scan costs the same as a one-page memo.
 *
 * `length` past the end of the object is not an error: R2 returns what
 * is there, which is what every caller here wants.
 *
 * Returns null when the object is missing, and an empty array for a
 * zero-length request, so a caller never has to distinguish "no bytes"
 * from "no object" by length alone.
 */
export async function objectRange(
  storageKey: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  if (length <= 0) return new Uint8Array(0)

  const bucket = await artifactBucket()
  if (bucket) {
    const object = await bucket.get(storageKey, { range: { offset, length } })
    if (!object) return null
    return new Uint8Array(await object.arrayBuffer())
  }

  const filePath = localArtifactPath(storageKey)
  if (!filePath) return null
  const { open } = await import('node:fs/promises')
  const handle = await open(filePath, 'r')
  try {
    const buffer = new Uint8Array(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
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
