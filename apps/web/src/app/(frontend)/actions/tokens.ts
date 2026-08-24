'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { newToken } from '../../../domain/tokens'
import { getCurrentUser } from '../../../lib/auth'

/**
 * Minting and revoking a reader's personal access token.
 *
 * The token itself is Payload's `useAPIKey` field on the user row —
 * this is a screen for it at `/account/tokens`, not a second mechanism.
 * That is what keeps `payload.auth()` the only thing that resolves a
 * credential: the admin API in `app/(frontend)/api/admin/` needed no
 * change to accept one, and neither would anything added later.
 *
 * We supply the token value rather than letting Payload generate it, so
 * it carries our prefix (`domain/tokens.ts`). Payload only ever derives
 * `apiKeyIndex` from whatever value it is given, so a supplied one
 * authenticates exactly as a generated one does.
 *
 * There is one token per account, so minting is also rotating. Nothing
 * here is additive: the previous value is overwritten and stops
 * authenticating the moment this returns, which is the behaviour a
 * revoke-and-replace needs anyway.
 *
 * Both take the `(previous, formData)` shape `useActionState` calls with
 * and read neither argument. Nothing about either act is chosen by the
 * caller — which account is acted on comes from the session, and there
 * is no second thing to say.
 */

export type TokenState = {
  error?: string
  notice?: string
  /**
   * The token, when this call is what created it.
   *
   * Returned so the page can offer it for copying immediately. It is
   * *not* the page's source of truth — the token is stored encrypted
   * rather than hashed, so `/account/tokens` can read it back on any
   * later visit and there is no "you will not see this again" moment to
   * engineer around.
   */
  token?: string
}

export async function createToken(
  _prev: TokenState,
  _formData: FormData,
): Promise<TokenState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const token = newToken()
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { enableAPIKey: true, apiKey: token },
    // As every other account action does. Ownership was decided above
    // by reading the session — the id written is the id that signed in,
    // and no part of it comes from the form.
    overrideAccess: true,
  })

  revalidatePath('/account/tokens')
  return { token, notice: 'Token created.' }
}

export async function revokeToken(
  _prev: TokenState,
  _formData: FormData,
): Promise<TokenState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const payload = await getPayload({ config })

  // Both fields, not just the flag. `enableAPIKey: false` alone stops
  // the strategy matching, but it leaves the secret sitting in the row
  // where turning the flag back on would resurrect a token its owner
  // believes they destroyed.
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { enableAPIKey: false, apiKey: null },
    overrideAccess: true,
  })

  revalidatePath('/account/tokens')
  return { notice: 'Token revoked. Anything using it will stop working now.' }
}
