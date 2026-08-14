/**
 * Turning a verified Google identity into a NobleSee session.
 *
 * Shared by the two ways in — the redirect flow and One Tap — so they
 * cannot drift. They differ only in how the ID token reaches us and how
 * the answer is delivered; what an identity *means* for our accounts is
 * one decision, made once, in `domain/googleIdentity.ts`.
 */

import config from '@payload-config'
import {
  createLocalReq,
  generatePayloadCookie,
  getFieldsToSign,
  getPayload,
  jwtSign,
} from 'payload'
import { addSessionToUser } from 'payload/shared'

import {
  SIGN_IN_REFUSAL_MESSAGES,
  decideGoogleSignIn,
  type ExistingAccount,
  type GoogleProfile,
} from '../domain/googleIdentity'
import { mirrorAvatar } from './avatars'
import { accrueMonthlyCredits, grantSignupCredits } from './credits'
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
      // No avatar yet: the mirrored picture is keyed on the account's
      // id, which does not exist until this call returns. It is stored
      // a moment later, by the same code that refreshes it on every
      // subsequent sign-in.
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
  let storedAvatarUrl: string | null = null
  try {
    if (decision.action === 'create') {
      userId = await createReader(payload, decision.profile)
      await grantSignupCredits(payload, userId)
    } else {
      userId = decision.accountId
      const existing = await payload.findByID({
        collection: 'users',
        id: userId,
        overrideAccess: true,
      })
      storedAvatarUrl = existing.avatarUrl ?? null

      await payload.update({
        collection: 'users',
        id: userId,
        data: {
          ...(decision.action === 'link_and_sign_in' ? { googleId: profile.googleId } : {}),
          // Only fills a gap. A reader who set their own display name
          // here meant it, and having Google quietly overwrite it on
          // the next sign-in would be the kind of thing that looks like
          // a bug precisely because it is one.
          ...(!existing.displayName && profile.displayName
            ? { displayName: profile.displayName }
            : {}),
        },
        overrideAccess: true,
      })
    }
  } catch {
    return { ok: false, message: 'Could not complete the sign-in. Please try again.' }
  }

  // Whatever the calendar owes them. Signing in is what pays the
  // monthly grant; a reader who just signed up has their baseline set
  // above and is owed nothing yet.
  if (decision.action !== 'create') await accrueMonthlyCredits(payload, userId)

  // The picture, copied into our own bucket so the reader's browser
  // never has to ask Google for it. Checked on every sign-in rather
  // than only the first: Google's URL changes when the reader changes
  // their photo, and `mirrorAvatar` short-circuits when it has not.
  //
  // Deliberately outside the try above, and deliberately unable to
  // fail: a sign-in must not depend on googleusercontent.com being
  // reachable. No picture simply means initials.
  if (profile.avatarUrl) {
    const mirrored = await mirrorAvatar({
      userId,
      sourceUrl: profile.avatarUrl,
      currentAvatarUrl: storedAvatarUrl,
    })
    if (mirrored && mirrored !== storedAvatarUrl) {
      try {
        await payload.update({
          collection: 'users',
          id: userId,
          data: { avatarUrl: mirrored },
          overrideAccess: true,
        })
      } catch {
        // The bytes are in the bucket but the pointer did not save.
        // The reader gets initials this time and we try again on the
        // next sign-in; nothing here is worth refusing a session over.
      }
    }
  }

  const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })

  // Payload's own session, issued without a password — the reader has
  // just proved who they are to Google, which is the whole point.
  const collectionConfig = payload.collections['users'].config

  // Payload 3 authenticates against a server-side session, not the JWT
  // alone: the token carries a `sid` and `payload.auth` looks it up in
  // the user's `sessions`. A token without one verifies as a signature
  // and is then rejected as a login — which looks exactly like a
  // successful sign-in that does not stick. `login` does this same call;
  // minting a token by hand has to do it too.
  const req = await createLocalReq({}, payload)
  const { sid } = await addSessionToUser({ collectionConfig, payload, req, user: user as never })

  const fieldsToSign = getFieldsToSign({
    collectionConfig,
    email: user.email,
    user: { ...user, collection: 'users' } as never,
    ...(sid ? { sid } : {}),
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
