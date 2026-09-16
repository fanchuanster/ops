import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { logError } from './logError'

export async function objectBucket(): Promise<R2Bucket | null> {
  return artifactBucket()
}

async function artifactBucket(): Promise<R2Bucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    return env.ARTIFACTS ?? null
  } catch {
    return null
  }
}

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

export async function deleteObjects(keys: readonly string[]): Promise<void> {
  const bucket = await artifactBucket()
  if (!bucket || keys.length === 0) return
  try {
    await bucket.delete([...keys])
  } catch (error) {
    logError('storage: delete objects', error)
  }
}

export async function isObjectStorageConfigured(): Promise<boolean> {
  return (await artifactBucket()) !== null
}

export async function artifactStream(storageKey: string): Promise<ReadableStream | null> {
  const bucket = await artifactBucket()
  if (!bucket) return null
  const object = await bucket.get(storageKey)
  return object?.body ?? null
}

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
