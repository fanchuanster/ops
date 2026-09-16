const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

const JWKS_FALLBACK_TTL_MS = 60 * 60 * 1000

interface CachedJwks {
  keys: JsonWebKey[]
  expiresAt: number
}

let jwksCache: CachedJwks | null = null

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>
}

async function fetchJwks(): Promise<JsonWebKey[]> {
  const response = await fetch(GOOGLE_JWKS_URL)
  if (!response.ok) throw new Error(`Google JWKS fetch failed (${response.status})`)

  const body = (await response.json()) as { keys?: JsonWebKey[] }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('Google JWKS response contained no keys')
  }

  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : JWKS_FALLBACK_TTL_MS

  jwksCache = { keys: body.keys, expiresAt: Date.now() + ttl }
  return body.keys
}

async function keysFor(kid: string): Promise<JsonWebKey[]> {
  const cached = jwksCache && jwksCache.expiresAt > Date.now() ? jwksCache.keys : null
  const match = cached?.filter((key) => (key as { kid?: string }).kid === kid)
  if (match && match.length > 0) return match

  const fresh = await fetchJwks()
  return fresh.filter((key) => (key as { kid?: string }).kid === kid)
}

export async function verifyGoogleIdTokenSignature(
  idToken: string,
): Promise<Record<string, unknown>> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID token is not a JWT')

  const header = decodeSegment(parts[0])

  if (header.alg !== 'RS256') throw new Error(`unexpected ID token algorithm: ${header.alg}`)
  const kid = typeof header.kid === 'string' ? header.kid : null
  if (!kid) throw new Error('ID token has no key id')

  const candidates = await keysFor(kid)
  if (candidates.length === 0) throw new Error('no Google signing key matches this token')

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const signature = base64UrlToBytes(parts[2])

  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
    if (ok) return decodeSegment(parts[1])
  }

  throw new Error('ID token signature did not verify')
}
