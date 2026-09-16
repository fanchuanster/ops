'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { checkAccountEmail, checkRoleChange } from '../../../domain/accounts'
import { currentAdmin, isAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

export type ReaderState = { error?: string; ok?: string }

export async function saveReader(
  _prev: ReaderState,
  formData: FormData,
): Promise<ReaderState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const readerId = Number(formData.get('readerId'))
  if (!Number.isInteger(readerId)) return { error: 'No reader named.' }

  const check = checkAccountEmail(String(formData.get('email') ?? ''))
  if (!check.valid) {
    return {
      error:
        check.problem === 'empty'
          ? 'An account needs an email address.'
          : 'That does not look like an email address.',
    }
  }

  const makeAdmin = formData.get('isAdmin') === 'on'
  const role = checkRoleChange({
    actorId: Number(admin.id),
    targetId: readerId,
    makeAdmin,
  })
  if (!role.ok) {
    return {
      error:
        'You cannot withdraw your own admin role — somebody has to be able to grant it back.',
    }
  }

  const payload = await getPayload({ config })

  const reader = await payload
    .findByID({ collection: 'users', id: readerId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!reader) return { error: 'No such reader.' }

  if (check.email !== reader.email) {
    const clash = await payload.find({
      collection: 'users',
      where: { and: [{ email: { equals: check.email } }, { id: { not_equals: readerId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (clash.docs.length > 0) {
      return { error: `Another account already uses ${check.email}.` }
    }
  }

  const roles: ('reader' | 'editor' | 'admin')[] = makeAdmin ? ['reader', 'admin'] : ['reader']

  try {
    await payload.update({
      collection: 'users',
      id: readerId,
      data: { email: check.email, roles },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.readers.save', error)
    return { error: 'Those changes could not be saved.' }
  }

  revalidatePath('/admin/users')

  const became = makeAdmin && !isAdmin(reader)
  const lost = !makeAdmin && isAdmin(reader)
  if (became) return { ok: 'Saved. They are an administrator now.' }
  if (lost) return { ok: 'Saved. They are an ordinary reader now.' }
  return { ok: 'Saved.' }
}
