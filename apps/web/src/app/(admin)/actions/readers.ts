'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { checkAccountEmail, checkRoleChange } from '../../../domain/accounts'
import { currentAdmin, isAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * The two things an administrator does to somebody else's account:
 * correct the email, and grant or withdraw the admin role.
 *
 * Both were the CMS's until 2026-08-24, and this is what replaces them
 * — the last screens standing between the editorial admin and deleting
 * `/cms` altogether. Everything else the CMS could do to an account is
 * deliberately *not* here:
 *
 *   credits      not editable anywhere. The field refuses writes at
 *                field level (`collections/Users.ts`) and only
 *                `lib/credits.ts` moves a balance, against a ledger.
 *                A form that could set it would be a second, unaudited
 *                answer to "how much does this reader have".
 *   password     readers reset their own. An administrator who can set
 *                a password can sign in as anybody.
 *   kindleEmail  the reader's own, on their own account page.
 *
 * The role is a checkbox rather than a role picker because there are
 * two roles that mean anything to the code — `admin`, and everyone else
 * — and offering `editor` as a third would imply a permission set that
 * nothing checks for.
 */

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

  // Email is unique on an auth collection, and the adapter surfaces the
  // clash as a raw failed-query message with nothing field-shaped in
  // it. Checked here for the sentence — the same reason the Library
  // panel checks a title before saving it.
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

  /**
   * The roles array is rewritten wholesale rather than having `admin`
   * added to or removed from it, so the checkbox means exactly what it
   * shows. `reader` is kept underneath because it is the collection's
   * default and an account with an empty roles array is a shape no
   * other code expects.
   */
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
