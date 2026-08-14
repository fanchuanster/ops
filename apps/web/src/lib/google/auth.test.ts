/**
 * The service-account handshake.
 *
 * Signing is a real RSA key here rather than a stub — a JWT that Google
 * would reject is the failure this is guarding against, and only a real
 * signature proves the assertion is well-formed.
 */

import { generateKeyPairSync } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildAssertion,
  googleAccessToken,
  parseServiceAccount,
  pemToDer,
  resetGoogleAuthCache,
} from './auth'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

const account = {
  client_email: 'noblesee-converter@my-project-first-296702.iam.gserviceaccount.com',
  private_key: pem,
  token_uri: 'https://oauth2.googleapis.com/token',
}

const encoded = Buffer.from(JSON.stringify(account)).toString('base64')

beforeEach(() => resetGoogleAuthCache())
afterEach(() => vi.unstubAllGlobals())

describe('reading the credential', () => {
  it('accepts the base64 Terraform emits', () => {
    expect(parseServiceAccount(encoded).client_email).toBe(account.client_email)
  })

  it('accepts raw JSON too, because someone will paste the file', () => {
    expect(parseServiceAccount(JSON.stringify(account)).client_email).toBe(account.client_email)
  })

  it('says what is missing rather than failing later', () => {
    expect(() => parseServiceAccount(btoa('{"client_email":"a@b"}'))).toThrow(/private_key/)
  })

  it('defaults the token endpoint', () => {
    const partial = btoa(JSON.stringify({ client_email: 'a@b', private_key: pem }))
    expect(parseServiceAccount(partial).token_uri).toBe('https://oauth2.googleapis.com/token')
  })
})

describe('the assertion', () => {
  it('is a three-part JWT signed with RS256', async () => {
    const assertion = await buildAssertion({ account, scope: 'scope' })
    const parts = assertion.split('.')
    expect(parts).toHaveLength(3)

    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString())
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('claims the account, the scope and the audience Google expects', async () => {
    const now = Date.parse('2026-08-14T21:00:00Z')
    const assertion = await buildAssertion({ account, scope: 'https://example/scope', now })
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString())

    expect(claims).toMatchObject({
      iss: account.client_email,
      scope: 'https://example/scope',
      aud: account.token_uri,
      iat: now / 1000,
      exp: now / 1000 + 3600,
    })
  })

  it('is base64url, not base64 — Google rejects padding and +/', async () => {
    const assertion = await buildAssertion({ account, scope: 'scope' })
    expect(assertion).not.toMatch(/[+/=]/)
  })
})

describe('exchanging it', () => {
  it('caches the token instead of minting one per call', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ access_token: 'tok', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchSpy)

    expect(await googleAccessToken(encoded)).toBe('tok')
    expect(await googleAccessToken(encoded)).toBe('tok')
    // Every Document AI and Storage call goes through this; a round trip
    // each would double the latency of the whole pipeline.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('mints again once the token is close to expiring', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ access_token: 'tok', expires_in: 30 }))
    vi.stubGlobal('fetch', fetchSpy)

    await googleAccessToken(encoded)
    await googleAccessToken(encoded)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('surfaces what Google said when the exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })))
    await expect(googleAccessToken(encoded)).rejects.toThrow(/invalid_grant/)
  })
})

describe('PEM handling', () => {
  it('strips the armour and decodes to DER', () => {
    const der = pemToDer(pem)
    // A PKCS#8 RSA key is a DER SEQUENCE, so it starts 0x30.
    expect(der[0]).toBe(0x30)
    expect(der.byteLength).toBeGreaterThan(1000)
  })
})
