export interface GoogleClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  sub?: unknown
  nonce?: unknown
  email?: unknown
  email_verified?: unknown
  name?: unknown
  picture?: unknown
}

export interface GoogleProfile {
  googleId: string
  email: string
  emailVerified: boolean
  displayName?: string
  avatarUrl?: string
}

function usableAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

export type ClaimsResult =
  | { ok: true; profile: GoogleProfile }
  | { ok: false; reason: ClaimsRejection }

export type ClaimsRejection =
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'nonce_mismatch'
  | 'no_subject'
  | 'no_email'

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

export function verifyGoogleClaims({
  claims,
  clientId,
  nonce,
  now,
  leewaySeconds = 60,
}: {
  claims: GoogleClaims
  clientId: string
  nonce: string
  now: Date
  leewaySeconds?: number
}): ClaimsResult {
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
    return { ok: false, reason: 'wrong_issuer' }
  }

  if (claims.aud !== clientId) {
    return { ok: false, reason: 'wrong_audience' }
  }

  const exp = typeof claims.exp === 'number' ? claims.exp : Number(claims.exp)
  if (!Number.isFinite(exp) || exp * 1000 + leewaySeconds * 1000 <= now.getTime()) {
    return { ok: false, reason: 'expired' }
  }

  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) {
    return { ok: false, reason: 'nonce_mismatch' }
  }

  if (typeof claims.sub !== 'string' || !claims.sub) {
    return { ok: false, reason: 'no_subject' }
  }

  if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
    return { ok: false, reason: 'no_email' }
  }

  return {
    ok: true,
    profile: {
      googleId: claims.sub,
      email: claims.email.trim().toLowerCase(),
      emailVerified: claims.email_verified === true,
      displayName: typeof claims.name === 'string' ? claims.name.trim() : undefined,
      avatarUrl: usableAvatarUrl(claims.picture),
    },
  }
}

export interface ExistingAccount {
  id: string | number
  email: string
  googleId?: string | null
}

export type SignInAction =
  | { action: 'sign_in'; accountId: string | number }
  | { action: 'link_and_sign_in'; accountId: string | number }
  | { action: 'create'; profile: GoogleProfile }
  | { action: 'refuse'; reason: SignInRefusal }

export type SignInRefusal = 'email_unverified' | 'linked_to_other_account'

export function decideGoogleSignIn({
  profile,
  byGoogleId,
  byEmail,
}: {
  profile: GoogleProfile
  byGoogleId?: ExistingAccount | null
  byEmail?: ExistingAccount | null
}): SignInAction {
  if (!profile.emailVerified) {
    return { action: 'refuse', reason: 'email_unverified' }
  }

  if (byGoogleId) {
    return { action: 'sign_in', accountId: byGoogleId.id }
  }

  if (byEmail) {
    if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
      return { action: 'refuse', reason: 'linked_to_other_account' }
    }
    return { action: 'link_and_sign_in', accountId: byEmail.id }
  }

  return { action: 'create', profile }
}

export const SIGN_IN_REFUSAL_MESSAGES: Record<SignInRefusal | ClaimsRejection, string> = {
  email_unverified:
    'Google has not verified the email address on that account, so we cannot use it to sign in. Verify it with Google, or sign in with a password instead.',
  linked_to_other_account:
    'That email address is already linked to a different Google account. Sign in with your password instead.',
  wrong_issuer: 'That sign-in did not come from Google. Please try again.',
  wrong_audience: 'That sign-in was not issued for NobleSee. Please try again.',
  expired: 'That sign-in took too long and expired. Please try again.',
  nonce_mismatch: 'That sign-in could not be matched to your browser. Please try again.',
  no_subject: 'Google did not identify the account. Please try again.',
  no_email: 'Google did not share an email address, which an account needs.',
}
