import { createHash, randomBytes } from 'crypto'

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export const GOOGLE_CALLBACK_PATH = '/auth/google/callback'

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

export function googleOAuthConfig(origin: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
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

export function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID token is not a JWT')
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  )
  return JSON.parse(payload) as Record<string, unknown>
}
