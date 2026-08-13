/**
 * Verifying a Google ID token that arrived from the browser.
 *
 * This exists because One Tap is a different trust situation from the
 * redirect flow, and the difference is easy to miss.
 *
 * In the redirect flow the ID token comes back from Google's token
 * endpoint, server-to-server over TLS, so the transport itself proves
 * where it came from and `decodeIdTokenClaims` may read it unverified —
 * OIDC Core section 3.1.3.7 says as much. A One Tap credential is handed
 * to our JavaScript and posted to us by the client. Anything the client
 * can post, an attacker can post: without a signature check, forging an
 * identity is a matter of base64-encoding a JSON object with someone
 * else's email in it.
 *
 * So the signature is verified against Google's published keys before a
 * single claim is believed. `verifyGoogleClaims` in the domain layer then
 * checks what the signature does not establish — audience, expiry, nonce
 * and whether the address is verified.
 */

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

/** Google publishes RS256 keys and rotates them on the order of days. */
const JWKS_FALLBACK_TTL_MS = 60 * 60 * 1000

interface CachedJwks {
  keys: JsonWebKey[]
  expiresAt: number
}

// Per-isolate, which is the right lifetime: a Worker isolate is
// short-lived, and the cache exists to avoid a fetch per sign-in rather
// than to be authoritative.
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

  // Honour Google's own cache lifetime rather than inventing one, so key
  // rotation is picked up on Google's schedule.
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : JWKS_FALLBACK_TTL_MS

  jwksCache = { keys: body.keys, expiresAt: Date.now() + ttl }
  return body.keys
}

async function keysFor(kid: string): Promise<JsonWebKey[]> {
  const cached = jwksCache && jwksCache.expiresAt > Date.now() ? jwksCache.keys : null
  const match = cached?.filter((key) => (key as { kid?: string }).kid === kid)
  if (match && match.length > 0) return match

  // Either nothing cached, or a key id we have not seen — which is what
  // a rotation looks like from here. Re-fetch once before giving up.
  const fresh = await fetchJwks()
  return fresh.filter((key) => (key as { kid?: string }).kid === kid)
}

/**
 * Verify a browser-supplied Google ID token and return its claims.
 *
 * Throws if the token is malformed, uses an unexpected algorithm, or its
 * signature does not check out. Says nothing about audience, expiry or
 * nonce — that is `verifyGoogleClaims`, and both are required.
 */
export async function verifyGoogleIdTokenSignature(
  idToken: string,
): Promise<Record<string, unknown>> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID token is not a JWT')

  const header = decodeSegment(parts[0])

  // Pinned, not merely read. Accepting whatever `alg` the token asks for
  // is the classic JWT confusion bug, and `none` is the punchline.
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
