/**
 * Turning a verified Google identity into a NobleSee session.
 *
 * Shared by the two ways in — the redirect flow and One Tap — so they
 * cannot drift. They differ only in how the ID token reaches us and how
 * the answer is delivered; what an identity *means* for our accounts is
 * one decision, made once, in `domain/googleIdentity.ts`.
 */

import config from '@payload-config'
import { generatePayloadCookie, getFieldsToSign, getPayload, jwtSign } from 'payload'

import {
  SIGN_IN_REFUSAL_MESSAGES,
  decideGoogleSignIn,
  type ExistingAccount,
  type GoogleProfile,
} from '../domain/googleIdentity'
import { randomToken } from './googleOAuth'

export type GoogleSessionResult =
  | { ok: true; cookie: string }
  | { ok: false; message: string }

/**
 * Create a reader for a Google identity.
 *
 * Payload's auth requires a password, and this reader does not have one.
 * A long random value is set rather than a blank or a known placeholder:
 * it is never shown to anyone and never used, so the account can only be
 * entered through Google — until the reader sets a real password through
 * password reset, which works because the address is verified.
 */
async function createReader(
  payload: Awaited<ReturnType<typeof getPayload>>,
  profile: GoogleProfile,
): Promise<string | number> {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: profile.email,
      password: randomToken(48),
      displayName: profile.displayName || undefined,
      googleId: profile.googleId,
      roles: ['reader'],
    },
    overrideAccess: true,
  })
  return created.id
}

/**
 * Resolve a verified Google profile to a session cookie.
 *
 * The profile must already have had its claims verified — audience,
 * expiry, nonce and `email_verified` — and, if it came from a browser,
 * its signature checked. This function trusts what it is given.
 */
export async function sessionForGoogleProfile(
  profile: GoogleProfile,
): Promise<GoogleSessionResult> {
  const payload = await getPayload({ config })

  const asAccount = (doc: { id: string | number; email: string; googleId?: string | null }) =>
    ({ id: doc.id, email: doc.email, googleId: doc.googleId ?? null }) as ExistingAccount

  const [linked, byEmail] = await Promise.all([
    payload.find({
      collection: 'users',
      where: { googleId: { equals: profile.googleId } },
      limit: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'users',
      where: { email: { equals: profile.email } },
      limit: 1,
      overrideAccess: true,
    }),
  ])

  const decision = decideGoogleSignIn({
    profile,
    byGoogleId: linked.docs[0] ? asAccount(linked.docs[0]) : null,
    byEmail: byEmail.docs[0] ? asAccount(byEmail.docs[0]) : null,
  })

  if (decision.action === 'refuse') {
    return { ok: false, message: SIGN_IN_REFUSAL_MESSAGES[decision.reason] }
  }

  let userId: string | number
  try {
    if (decision.action === 'create') {
      userId = await createReader(payload, decision.profile)
    } else {
      userId = decision.accountId
      if (decision.action === 'link_and_sign_in') {
        await payload.update({
          collection: 'users',
          id: userId,
          data: { googleId: profile.googleId },
          overrideAccess: true,
        })
      }
    }
  } catch {
    return { ok: false, message: 'Could not complete the sign-in. Please try again.' }
  }

  const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })

  // Payload's own session, issued without a password — the reader has
  // just proved who they are to Google, which is the whole point.
  const collectionConfig = payload.collections['users'].config
  const fieldsToSign = getFieldsToSign({
    collectionConfig,
    email: user.email,
    user: { ...user, collection: 'users' } as never,
  })
  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: collectionConfig.auth.tokenExpiration,
  })

  return {
    ok: true,
    cookie: generatePayloadCookie({
      collectionAuthConfig: collectionConfig.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token,
    }),
  }
}
