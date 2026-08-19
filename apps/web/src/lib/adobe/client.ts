/**
 * Adobe PDF Services, over its REST API.
 *
 * The one part of phase 1 that is not on Cloudflare. Reading a scanned
 * book needs more memory and more CPU time than a Worker has, so it is
 * not run here — it is *called*, and a Worker is billed almost nothing
 * for waiting on a fetch it is not computing during.
 *
 * ## The shape of a job
 *
 *   POST /token                  a bearer token, good for hours
 *   POST /assets                 an upload URI and an asset id
 *   PUT  uploadUri               the PDF bytes, straight to Adobe
 *   POST /operation/exportpdf    returns a job URL in `Location`
 *   GET  jobUrl                  minutes later: `done` and a download URI
 *   GET  downloadUri             the DOCX
 *
 * Nothing here blocks a request on the middle step. `startExport`
 * returns as soon as Adobe accepts the job; whoever polls does so on a
 * later request. A Worker cannot hold a request open for the length of
 * an export and should not try.
 *
 * ## Why the SDK is not used
 *
 * `@adobe/pdfservices-node-sdk` wraps exactly these six calls, and it
 * wraps them in Node streams and filesystem paths. A Worker has neither.
 * Six fetches against a documented REST API is less code than the
 * shimming would be, and it keeps the dependency behind an interface the
 * way CLAUDE.md section 2.2 asks — this file is the interface.
 */

import { type ExportOutcome, readExportStatus } from '../../domain/adobe'

const BASE = 'https://pdf-services.adobe.io'

export interface AdobeCredentials {
  clientId: string
  clientSecret: string
}

/** Everything Adobe wants on a request that is not the presigned kind. */
function headers(credentials: AdobeCredentials, token: string): Record<string, string> {
  return {
    'X-API-Key': credentials.clientId,
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Read an error out of a failed response without letting it be enormous.
 *
 * The message reaches an uploader through `conversion.message`, so it
 * has to be short and it must not be the raw HTML of an error page.
 */
async function describe(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  const trimmed = body.trim().slice(0, 200)
  return trimmed.length > 0 ? `${response.status}: ${trimmed}` : `HTTP ${response.status}`
}

/**
 * A bearer token.
 *
 * Fetched per call rather than cached. A Worker isolate is not a durable
 * place to keep a credential — it may be discarded between two requests
 * or live for hours, so a cache here would be a correctness risk in
 * exchange for saving one round trip on a path that is already about to
 * upload a hundred megabytes.
 */
export async function accessToken(credentials: AdobeCredentials): Promise<string> {
  const response = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  })

  if (!response.ok) {
    // 403 here is almost never a wrong secret. Adobe answers a bad id or
    // a bad secret with `invalid_client`, naming which one; a *valid*
    // pair that is not entitled to PDF Services answers `unauthorized_
    // client` — or, on this endpoint, "the client is not allowed to
    // generate the token". Saying "rejected the credentials" would send
    // whoever reads this to re-check two values that are already right.
    const detail = await describe(response)
    const unentitled = response.status === 403 || /unauthorized_client/.test(detail)
    throw new Error(
      unentitled
        ? `Adobe accepted the credentials but will not issue a token for PDF Services (${detail}). This credential belongs to a project without the PDF Services API: its scopes must include DCAPI, and identity-only scopes (openid, profile, email, AdobeID, org.read) mean it was issued for something else, such as Sign in with Adobe ID. Create a PDF Services credential at https://acrobatservices.adobe.com/dc-integration-creation-app-cdn/main.html?api=pdf-services-api and use that pair instead.`
        : `Adobe rejected the credentials (${detail}).`,
    )
  }

  const body = (await response.json()) as { access_token?: unknown }
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('Adobe returned no access token.')
  }
  return body.access_token
}

export interface UploadTarget {
  assetID: string
  uploadUri: string
}

/** Ask for somewhere to put a file. */
export async function createAsset(
  credentials: AdobeCredentials,
  token: string,
  mediaType = 'application/pdf',
): Promise<UploadTarget> {
  const response = await fetch(`${BASE}/assets`, {
    method: 'POST',
    headers: { ...headers(credentials, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType }),
  })

  if (!response.ok) {
    throw new Error(`Adobe would not accept an upload (${await describe(response)}).`)
  }

  const body = (await response.json()) as { assetID?: unknown; uploadUri?: unknown }
  if (typeof body.assetID !== 'string' || typeof body.uploadUri !== 'string') {
    throw new Error('Adobe returned an unusable upload target.')
  }
  return { assetID: body.assetID, uploadUri: body.uploadUri }
}

/**
 * Put the bytes where Adobe asked.
 *
 * Presigned, so it carries no credentials of ours — which is the reason
 * the upload can be a plain PUT of the body rather than going through
 * the API host and counting against its rate limit.
 */
export async function uploadAsset(
  uploadUri: string,
  body: Uint8Array,
  mediaType = 'application/pdf',
): Promise<void> {
  const response = await fetch(uploadUri, {
    method: 'PUT',
    headers: { 'Content-Type': mediaType },
    body: body as BodyInit,
  })

  if (!response.ok) {
    throw new Error(`The file could not be uploaded to Adobe (${await describe(response)}).`)
  }
}

/**
 * Start an export, and return the URL that reports on it.
 *
 * The job URL arrives in the `Location` header of a 201, not in a body.
 * It is the only durable handle on the job: lose it and the work
 * continues, is paid for, and can never be collected — which is why the
 * caller records it before doing anything else.
 */
export async function startExport({
  credentials,
  token,
  assetID,
  locale,
}: {
  credentials: AdobeCredentials
  token: string
  assetID: string
  locale: string
}): Promise<string> {
  const response = await fetch(`${BASE}/operation/exportpdf`, {
    method: 'POST',
    headers: { ...headers(credentials, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetID, targetFormat: 'docx', ocrLang: locale }),
  })

  if (!response.ok) {
    throw new Error(`Adobe would not start the export (${await describe(response)}).`)
  }

  const location = response.headers.get('location')
  if (!location) {
    throw new Error('Adobe accepted the export but did not say where to find it.')
  }
  return location
}

/** Ask how a running export is doing. */
export async function exportStatus({
  credentials,
  token,
  jobUrl,
}: {
  credentials: AdobeCredentials
  token: string
  jobUrl: string
}): Promise<ExportOutcome> {
  const response = await fetch(jobUrl, { headers: headers(credentials, token) })

  if (!response.ok) {
    throw new Error(`Adobe would not report on the export (${await describe(response)}).`)
  }

  return readExportStatus(await response.json())
}

/**
 * Fetch the finished DOCX.
 *
 * Presigned and short-lived, so this happens on the same request that
 * saw the `done` status rather than being deferred — a URI recorded for
 * later would very likely be dead by the time it was used.
 */
export async function downloadResult(downloadUri: string): Promise<Uint8Array> {
  const response = await fetch(downloadUri)
  if (!response.ok) {
    throw new Error(`The finished file could not be fetched from Adobe (${await describe(response)}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Delete an asset once its result is safely stored.
 *
 * Best effort, and deliberately never fatal. Adobe expires assets after
 * 24 hours anyway, so a failed delete costs nothing but a copy of the
 * uploader's file sitting on someone else's disk slightly longer than it
 * had to — worth trying for, not worth failing a book over.
 */
export async function deleteAsset(
  credentials: AdobeCredentials,
  token: string,
  assetID: string,
): Promise<void> {
  await fetch(`${BASE}/assets/${encodeURIComponent(assetID)}`, {
    method: 'DELETE',
    headers: headers(credentials, token),
  }).catch(() => undefined)
}
