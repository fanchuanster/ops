import { type ExportOutcome, readExportStatus } from '../../domain/adobe'

const BASE = 'https://pdf-services.adobe.io'

export interface AdobeCredentials {
  clientId: string
  clientSecret: string
}

function headers(credentials: AdobeCredentials, token: string): Record<string, string> {
  return {
    'X-API-Key': credentials.clientId,
    Authorization: `Bearer ${token}`,
  }
}

async function describe(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  const trimmed = body.trim().slice(0, 200)
  return trimmed.length > 0 ? `${response.status}: ${trimmed}` : `HTTP ${response.status}`
}

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

export async function downloadResult(downloadUri: string): Promise<Uint8Array> {
  const response = await fetch(downloadUri)
  if (!response.ok) {
    throw new Error(`The finished file could not be fetched from Adobe (${await describe(response)}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

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
