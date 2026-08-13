/**
 * Forgery tests for the One Tap credential check.
 *
 * This is the only place in NobleSee where a caller-supplied token is
 * turned into an identity, so it is the only place where getting the
 * check wrong hands out accounts. Google's keys are stubbed rather than
 * fetched — the tests are about our verification, not about Google being
 * reachable, and a security test that depends on the network is a
 * security test that gets skipped.
 */

import { createSign, generateKeyPairSync } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyGoogleIdTokenSignature } from './googleIdToken'

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

const GOOGLE_KID = 'google-key-1'
const ATTACKER_KID = 'attacker-key-1'

// The pair Google is pretending to sign with, and the pair an attacker
// actually holds.
const google = generateKeyPairSync('rsa', { modulusLength: 2048 })
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 })

const claims = {
  iss: 'https://accounts.google.com',
  aud: 'client-id',
  sub: '12345',
  email: 'reader@example.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
}

function token(header: object, key: ReturnType<typeof generateKeyPairSync>['privateKey']) {
  const head = b64(header)
  const body = b64(claims)
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  return `${head}.${body}.${signer.sign(key).toString('base64url')}`
}

beforeEach(() => {
  const jwk = google.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { keys: [{ ...jwk, kid: GOOGLE_KID, alg: 'RS256', use: 'sig' }] },
        { headers: { 'cache-control': 'max-age=3600' } },
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('google id token signature', () => {
  it('accepts a token signed by a published Google key', async () => {
    const verified = await verifyGoogleIdTokenSignature(
      token({ alg: 'RS256', kid: GOOGLE_KID }, google.privateKey),
    )
    expect(verified.email).toBe('reader@example.com')
    expect(verified.sub).toBe('12345')
  })

  it('rejects a token signed by anyone else, even under a real key id', async () => {
    // The heart of it: an attacker who copies a genuine `kid` still
    // cannot produce a signature that key verifies.
    await expect(
      verifyGoogleIdTokenSignature(token({ alg: 'RS256', kid: GOOGLE_KID }, attacker.privateKey)),
    ).rejects.toThrow(/signature did not verify/)
  })

  it('rejects an unsigned token', async () => {
    // `alg: none` is the reason algorithms are pinned rather than read.
    await expect(
      verifyGoogleIdTokenSignature(`${b64({ alg: 'none' })}.${b64(claims)}.`),
    ).rejects.toThrow(/unexpected ID token algorithm/)
  })

  it('rejects an HMAC token, which would treat a public key as a shared secret', async () => {
    await expect(
      verifyGoogleIdTokenSignature(`${b64({ alg: 'HS256', kid: GOOGLE_KID })}.${b64(claims)}.c2ln`),
    ).rejects.toThrow(/unexpected ID token algorithm/)
  })

  it('rejects a key id Google does not publish', async () => {
    await expect(
      verifyGoogleIdTokenSignature(token({ alg: 'RS256', kid: ATTACKER_KID }, attacker.privateKey)),
    ).rejects.toThrow(/no Google signing key matches/)
  })

  it('rejects a token with no key id', async () => {
    await expect(
      verifyGoogleIdTokenSignature(token({ alg: 'RS256' }, google.privateKey)),
    ).rejects.toThrow(/no key id/)
  })

  it('rejects a payload tampered with after signing', async () => {
    const signed = token({ alg: 'RS256', kid: GOOGLE_KID }, google.privateKey)
    const [head, , signature] = signed.split('.')
    const swapped = b64({ ...claims, email: 'admin@noblesee.com' })
    await expect(verifyGoogleIdTokenSignature(`${head}.${swapped}.${signature}`)).rejects.toThrow(
      /signature did not verify/,
    )
  })

  it('rejects anything that is not a JWT', async () => {
    await expect(verifyGoogleIdTokenSignature('garbage')).rejects.toThrow(/not a JWT/)
  })
})
