/**
 * The Google OAuth 2.0 / OpenID Connect flow, server-side.
 *
 * Authorization Code with PKCE. The client secret never leaves the
 * Worker, the code is exchanged server-to-server, and the browser only
 * ever carries an opaque code plus the state and nonce cookies that bind
 * the round trip to itself.
 *
 * The decisions with security consequences — whether to trust the claims
 * and whether to link them to an existing account — are not here. They
 * are in `domain/googleIdentity.ts`, where they are tested. This module
 * is transport.
 */

import { createHash, randomBytes } from 'crypto'

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** The path Google redirects back to. Must match the console exactly. */
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback'

// Short-lived and single-use: they exist only for the seconds between
// leaving for Google and coming back.
export const OAUTH_COOKIE_MAX_AGE = 600

export const STATE_COOKIE = 'ns-google-state'
export const VERIFIER_COOKIE = 'ns-google-verifier'
export const NONCE_COOKIE = 'ns-google-nonce'
export const NEXT_COOKIE = 'ns-google-next'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Configuration, or null when Google sign-in is simply not set up.
 *
 * Null rather than throwing: an installation without Google credentials
 * is a perfectly good installation, and it should render a sign-in page
 * without the Google button instead of failing to render at all.
 */
export function googleOAuthConfig(origin: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
    // Derived from the request's own origin rather than configured
    // separately, so localhost and production cannot drift apart — and
    // so this is the same string Google is asked to match.
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, origin).toString(),
  }
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  )
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes))
}

/** S256 challenge for a PKCE verifier. */
export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function buildAuthorizationUrl({
  config,
  state,
  nonce,
  codeVerifier,
}: {
  config: GoogleOAuthConfig
  state: string
  nonce: string
  codeVerifier: string
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', codeChallenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  // Only an identity is wanted, so no refresh token is requested and
  // nothing needs storing. `select_account` lets a reader on a shared
  // machine choose, instead of being silently signed in as whoever used
  // the browser last.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export interface TokenResponse {
  id_token?: string
  access_token?: string
}

export async function exchangeCode({
  config,
  code,
  codeVerifier,
}: {
  config: GoogleOAuthConfig
  code: string
  codeVerifier: string
}): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Google token exchange failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as TokenResponse
}

/**
 * Read an ID token's payload without verifying its signature.
 *
 * Safe here and only here: the token came straight from Google's token
 * endpoint over TLS and never touched the browser. See the note on
 * `verifyGoogleClaims`, which checks everything the transport does not
 * establish. Never call this on a token that arrived from a client.
 */
export function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID token is not a JWT')
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  )
  return JSON.parse(payload) as Record<string, unknown>
}
