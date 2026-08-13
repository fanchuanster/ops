/**
 * Rules for signing a reader in with Google.
 *
 * The security of "sign in with Google" is almost entirely in two
 * decisions — whether to trust the claims that came back, and whether
 * they may be attached to an account that already exists — so both live
 * here, framework-independent and tested, rather than inside a route
 * handler where they would be exercised only by clicking through a
 * browser.
 *
 * Framework-independent, like everything in `src/domain`.
 */

/** The claims we care about from Google's ID token. */
export interface GoogleClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  sub?: unknown
  nonce?: unknown
  email?: unknown
  email_verified?: unknown
  name?: unknown
}

/** A verified Google identity, once the claims have passed. */
export interface GoogleProfile {
  /** Google's stable subject id. The account's real identifier. */
  googleId: string
  email: string
  emailVerified: boolean
  displayName?: string
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

/**
 * Google issues tokens under both spellings, and both are legitimate.
 */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/**
 * Check an ID token's claims.
 *
 * This does not verify the token's *signature*, and does not need to.
 * The token is fetched by the server directly from Google's token
 * endpoint over TLS, authenticated with the client secret, and never
 * passes through the browser — the case OpenID Connect Core §3.1.3.7
 * explicitly allows TLS server validation to stand in for signature
 * validation. What still has to be checked is that the token is *for
 * us*, is current, and answers the request we actually made, because
 * none of that follows from the transport.
 *
 * `now` is passed in rather than read from the clock so expiry is
 * testable.
 */
export function verifyGoogleClaims({
  claims,
  clientId,
  nonce,
  now,
  leewaySeconds = 60,
}: {
  claims: GoogleClaims
  clientId: string
  /** The nonce this login started with. */
  nonce: string
  now: Date
  leewaySeconds?: number
}): ClaimsResult {
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
    return { ok: false, reason: 'wrong_issuer' }
  }

  // A token minted for a different OAuth client is a valid Google token
  // and still must not sign anyone in here.
  if (claims.aud !== clientId) {
    return { ok: false, reason: 'wrong_audience' }
  }

  const exp = typeof claims.exp === 'number' ? claims.exp : Number(claims.exp)
  if (!Number.isFinite(exp) || exp * 1000 + leewaySeconds * 1000 <= now.getTime()) {
    return { ok: false, reason: 'expired' }
  }

  // Binds this token to the login that started in this browser. Without
  // it, a token obtained elsewhere could be replayed into someone
  // else's session.
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
      // Anything other than a literal true is treated as unverified.
      emailVerified: claims.email_verified === true,
      displayName: typeof claims.name === 'string' ? claims.name.trim() : undefined,
    },
  }
}

/** An account as far as this decision is concerned. */
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

/**
 * Decide what a verified Google identity means for our accounts.
 *
 * The dangerous case is the second one — a Google identity arriving with
 * an email that already has a password account here. Linking them is
 * what readers expect, and it is safe *only* because Google says the
 * address is verified. Without that check, anyone could register a
 * Google account claiming someone else's address and take over their
 * NobleSee account by clicking "Sign in with Google". So an unverified
 * email is refused outright rather than being allowed to create a
 * separate account, which would leave two accounts fighting over one
 * address.
 */
export function decideGoogleSignIn({
  profile,
  byGoogleId,
  byEmail,
}: {
  profile: GoogleProfile
  /** An account already linked to this Google id, if any. */
  byGoogleId?: ExistingAccount | null
  /** An account holding this email address, if any. */
  byEmail?: ExistingAccount | null
}): SignInAction {
  if (!profile.emailVerified) {
    return { action: 'refuse', reason: 'email_unverified' }
  }

  // The Google subject id is the identity, not the address. A reader who
  // changed their email at Google is still the same person, and is
  // signed into the account they already have.
  if (byGoogleId) {
    return { action: 'sign_in', accountId: byGoogleId.id }
  }

  if (byEmail) {
    // Somebody else's Google account is already linked to this address.
    // Refuse rather than move the link: silently re-pointing it would
    // hand this address's account to whoever signed in most recently.
    if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
      return { action: 'refuse', reason: 'linked_to_other_account' }
    }
    return { action: 'link_and_sign_in', accountId: byEmail.id }
  }

  return { action: 'create', profile }
}

/** What a refused sign-in should tell the reader. */
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
