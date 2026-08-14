/**
 * Authenticating to Google as a service account, from a Worker.
 *
 * There is no Google SDK here and there does not need to be: the whole
 * protocol is a signed JWT exchanged for an access token, and a Worker
 * already has RS256 signing in WebCrypto. Pulling in a client library to
 * do that would add megabytes to a script with a size limit.
 *
 * The credential is the service-account JSON, base64-encoded, in the
 * `GOOGLE_SERVICE_ACCOUNT_KEY` secret — which is the form Terraform
 * outputs it in, so it goes straight from `terraform output` into
 * `wrangler secret put` without anyone opening it.
 */

const TOKEN_LIFETIME_SECONDS = 3600

/** Renew slightly early: a token that expires mid-request is a failure. */
const RENEW_BEFORE_MS = 60_000

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
}

interface CachedToken {
  token: string
  expiresAt: number
}

// Per-isolate, which is the right scope: a token is valid for an hour,
// and an isolate rarely lives that long. Nothing is shared between
// requests that should not be.
let cached: CachedToken | null = null
let cachedKey: CryptoKey | null = null

export function parseServiceAccount(encoded: string): ServiceAccount {
  // Accept both the base64 Terraform emits and raw JSON, because someone
  // will paste the file itself at some point and the failure would
  // otherwise be an unreadable JSON parse error.
  const text = encoded.trim().startsWith('{') ? encoded : atob(encoded)
  const parsed = JSON.parse(text) as Partial<ServiceAccount>

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('service account JSON has no client_email or private_key')
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
  }
}

/** PEM to the DER bytes WebCrypto imports. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')

  const binary = atob(body)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64Url(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === 'string' ? bytes : String.fromCharCode(...(bytes as unknown as number[]))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The signed assertion Google exchanges for an access token. */
export async function buildAssertion({
  account,
  scope,
  now = Date.now(),
}: {
  account: ServiceAccount
  scope: string
  now?: number
}): Promise<string> {
  const issuedAt = Math.floor(now / 1000)
  const claims = {
    iss: account.client_email,
    scope,
    aud: account.token_uri,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  }

  const signingInput =
    base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    base64Url(new TextEncoder().encode(JSON.stringify(claims)))

  cachedKey ??= await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cachedKey,
    new TextEncoder().encode(signingInput),
  )

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

/**
 * An access token for the given scope.
 *
 * Cached until shortly before it expires. Every call to Document AI and
 * Cloud Storage goes through this, so minting one per request would add
 * a round trip to every one of them.
 */
export async function googleAccessToken(
  encodedKey: string,
  scope = 'https://www.googleapis.com/auth/cloud-platform',
): Promise<string> {
  if (cached && cached.expiresAt - RENEW_BEFORE_MS > Date.now()) return cached.token

  const account = parseServiceAccount(encodedKey)
  const assertion = await buildAssertion({ account, scope })

  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    // The body names the actual problem — a clock skew, a disabled key —
    // and none of it is secret.
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('Google returned no access token')

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? TOKEN_LIFETIME_SECONDS) * 1000,
  }
  return cached.token
}

/** Testing seam: forget the cached token and key. */
export function resetGoogleAuthCache(): void {
  cached = null
  cachedKey = null
}
