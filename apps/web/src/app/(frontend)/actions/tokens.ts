'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { newToken } from '../../../domain/tokens'
import { getCurrentUser } from '../../../lib/auth'

export type TokenState = {
  error?: string
  notice?: string
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

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { enableAPIKey: false, apiKey: null },
    overrideAccess: true,
  })

  revalidatePath('/account/tokens')
  return { notice: 'Token revoked. Anything using it will stop working now.' }
}
