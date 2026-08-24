import { APIError } from 'payload'

import { parseCollectionUpdate } from '../../../../../../domain/adminApi'
import { adminFromRequest, unauthorized } from '../../../../../../lib/apiAuth'
import { logError } from '../../../../../../lib/logError'
import { revalidateCuration } from '../../shared'

/**
 * One shelf, for a machine.
 *
 * `GET` to read it, `PATCH` to rename it, re-describe it, re-file it
 * under another shelf, or move it among its siblings.
 *
 * `parent` is writable and the nesting rules are *not* checked here.
 * They live in a hook on the collection — a shelf may not be its own
 * ancestor and the tree is three levels deep at most — precisely so
 * they hold for every door into the table. This route is the third
 * door, and it walks through the same gate as the other two.
 *
 * Authentication is a per-user API key or an ordinary session, then the
 * `admin` role; see `app/(frontend)/api/admin/books/[id]/route.ts` for
 * why the key belongs to a person rather than to the machine.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { payload, admin } = await adminFromRequest(request)
  if (!admin) return unauthorized()

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: 'Not a collection id.' }, { status: 400 })

  const collection = await payload
    .findByID({ collection: 'book-collections', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!collection) return Response.json({ error: 'No such collection.' }, { status: 404 })

  return Response.json({ collection: serialize(collection) })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { payload, admin } = await adminFromRequest(request)
  if (!admin) return unauthorized()

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: 'Not a collection id.' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Send a JSON object.' }, { status: 400 })
  }

  const parsed = parseCollectionUpdate(body)
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid update.', fields: parsed.errors }, { status: 400 })
  }

  try {
    const updated = await payload.update({
      collection: 'book-collections',
      id,
      data: parsed.data,
      overrideAccess: true,
      user: admin,
    })
    await revalidateCuration()
    return Response.json({ collection: serialize(updated) })
  } catch (error) {
    // The nesting hook refuses with a sentence a person can act on —
    // "a collection cannot stand on itself" — so it is passed through
    // rather than flattened into a 500.
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.status || 400 })
    }
    logError('api.admin.collections.patch', error)
    return Response.json({ error: 'That update could not be saved.' }, { status: 500 })
  }
}

function serialize(collection: {
  id: number | string
  title: string
  slug: string
  description?: string | null
  parent?: unknown
  sortOrder?: number | null
  updatedAt?: string
}) {
  const parent = collection.parent
  return {
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    description: collection.description ?? null,
    parent: typeof parent === 'object' && parent ? (parent as { id: number }).id : (parent ?? null),
    sortOrder: collection.sortOrder ?? null,
    updatedAt: collection.updatedAt,
  }
}
