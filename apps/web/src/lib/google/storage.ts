/**
 * Cloud Storage, for the files Document AI batch processing reads and
 * writes.
 *
 * R2 stays the canonical store. This bucket is scratch space for one
 * stage of one job — batch OCR cannot answer inline, it answers into a
 * bucket — and its objects are deleted after a week by a lifecycle rule
 * in `infra/documentai.tf`.
 */

import { googleAccessToken } from './auth'

const API = 'https://storage.googleapis.com/storage/v1/b'
const UPLOAD_API = 'https://storage.googleapis.com/upload/storage/v1/b'

/** Object names go in a path segment, so slashes must survive escaping. */
function encodeName(name: string): string {
  return encodeURIComponent(name)
}

export interface GcsObject {
  name: string
  size: number
}

/**
 * Whether an object is already there, and how big it is.
 *
 * Null when absent. A 404 is the expected answer, not an error.
 */
export async function statObject(
  token: string,
  bucket: string,
  name: string,
): Promise<GcsObject | null> {
  const response = await fetch(`${API}/${bucket}/o/${encodeName(name)}?fields=name,size`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Cloud Storage stat failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as { name: string; size?: string }
  return { name: body.name, size: Number(body.size ?? 0) }
}

export type UploadOutcome = 'uploaded' | 'already-there'

/**
 * Upload an object, unless it is already there.
 *
 * Two guards, doing different jobs. The `statObject` call is the one
 * that matters for cost: a book is tens of megabytes, and re-sending it
 * because a job was retried is bandwidth and time spent to arrive at the
 * bytes already sitting in the bucket.
 *
 * `ifGenerationMatch=0` is the one that matters for correctness. It tells
 * Cloud Storage to accept the write only if the object does not exist, so
 * two jobs racing on the same book cannot both upload — the check alone
 * is a read followed by a write, and anything can happen in between.
 * A 412 back from it means the other one won, which is a success here.
 */
export async function uploadIfAbsent({
  token,
  bucket,
  name,
  body,
  contentType,
}: {
  token: string
  bucket: string
  name: string
  body: ReadableStream | ArrayBuffer | Uint8Array
  contentType: string
}): Promise<UploadOutcome> {
  const existing = await statObject(token, bucket, name)
  if (existing) return 'already-there'

  const response = await fetch(
    `${UPLOAD_API}/${bucket}/o?uploadType=media&name=${encodeName(name)}&ifGenerationMatch=0`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: body as BodyInit,
    },
  )

  // Someone else uploaded it between the check and the write. That is
  // the outcome we wanted, reached by another route.
  if (response.status === 412) return 'already-there'

  if (!response.ok) {
    throw new Error(`Cloud Storage upload failed: ${response.status} ${await response.text()}`)
  }
  return 'uploaded'
}

/** Fetch an object's bytes. Used to read batch OCR output back. */
export async function readObject(
  token: string,
  bucket: string,
  name: string,
): Promise<Response> {
  const response = await fetch(`${API}/${bucket}/o/${encodeName(name)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Cloud Storage read failed: ${response.status} ${await response.text()}`)
  }
  return response
}

/** Object names under a prefix. Batch output lands under one. */
export async function listObjects(
  token: string,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(`${API}/${bucket}/o`)
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('fields', 'items(name),nextPageToken')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      throw new Error(`Cloud Storage list failed: ${response.status} ${await response.text()}`)
    }

    const body = (await response.json()) as {
      items?: { name: string }[]
      nextPageToken?: string
    }
    names.push(...(body.items ?? []).map((item) => item.name))
    pageToken = body.nextPageToken
  } while (pageToken)

  return names
}

/**
 * Copy a book from R2 into the conversion bucket, if it is not there.
 *
 * Named after the R2 key so the same book maps to the same object every
 * time — which is what makes the existence check mean anything. Keying
 * on the job would upload the same bytes again on every retry.
 */
export async function stageForConversion({
  encodedKey,
  bucket,
  sourceKey,
  body,
  contentType,
}: {
  encodedKey: string
  bucket: string
  sourceKey: string
  body: ReadableStream | ArrayBuffer | Uint8Array
  contentType: string
}): Promise<{ gcsName: string; outcome: UploadOutcome }> {
  const token = await googleAccessToken(encodedKey)
  const gcsName = `input/${sourceKey}`

  const outcome = await uploadIfAbsent({ token, bucket, name: gcsName, body, contentType })
  return { gcsName, outcome }
}
