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
import { logError } from './logError'

export type GoogleSessionResult =
  | { ok: true; cookie: string }
  | { ok: false; message: string }

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
          ...(!existing.displayName && profile.displayName
            ? { displayName: profile.displayName }
            : {}),
        },
        overrideAccess: true,
      })
    }
  } catch (error) {
    logError('googleSession: establish session', error)
    return { ok: false, message: 'Could not complete the sign-in. Please try again.' }
  }

  if (decision.action !== 'create') await accrueMonthlyCredits(payload, userId)

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
      } catch (error) {
        logError('googleSession: save avatar pointer', error)
      }
    }
  }

  const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })

  const collectionConfig = payload.collections['users'].config

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
