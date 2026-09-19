import { APIError } from 'payload'
import type { Payload } from 'payload'

import { parseBookUpdate } from '../../../../../../domain/adminApi'
import { levelFromId } from '../../../../../../domain/levels'
import { isInPublicLibrary } from '../../../../../../domain/moderation'
import { adminFromRequest, unauthorized } from '../../../../../../lib/apiAuth'
import { logError } from '../../../../../../lib/logError'
import { revalidateCuration } from '../../shared'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { payload, admin } = await adminFromRequest(request)
  if (!admin) return unauthorized()

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: 'Not a book id.' }, { status: 400 })

  const book = await payload
    .findByID({ collection: 'books', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return Response.json({ error: 'No such book.' }, { status: 404 })

  return Response.json({ book: serialize(book) })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { payload, admin } = await adminFromRequest(request)
  if (!admin) return unauthorized()

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: 'Not a book id.' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Send a JSON object.' }, { status: 400 })
  }

  const parsed = parseBookUpdate(body)
  if (!parsed.ok) return Response.json({ error: 'Invalid update.', fields: parsed.errors }, { status: 400 })

  const taken = await occupiedBy(payload, id, parsed.data)
  if (taken) {
    return Response.json(
      { error: `Another book already has that ${taken.field}.`, fields: [taken] },
      { status: 409 },
    )
  }

  try {
    const updated = await payload.update({
      collection: 'books',
      id,
      data: parsed.data,
      overrideAccess: true,
      user: admin,
    })

    await revalidateCuration()
    return Response.json({ book: serialize(updated) })
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.status || 400 })
    }
    logError('api.admin.books.patch', error)
    return Response.json({ error: 'That update could not be saved.' }, { status: 500 })
  }
}

async function occupiedBy(
  payload: Payload,
  id: number,
  data: Record<string, unknown>,
): Promise<{ field: string; message: string } | null> {
  const claims = ['title', 'slug'].filter((field) => typeof data[field] === 'string')
  if (claims.length === 0) return null

  const found = await payload.find({
    collection: 'books',
    where: {
      and: [
        { id: { not_equals: id } },
        { or: claims.map((field) => ({ [field]: { equals: data[field] } })) },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const clash = found.docs[0]
  if (!clash) return null
  const field = claims.find(
    (name) => (clash as unknown as Record<string, unknown>)[name] === data[name],
  )!
  return { field, message: `Book ${clash.id} already has this ${field}.` }
}

function serialize(book: {
  id: number | string
  title: string
  slug: string
  subtitle?: string | null
  author?: string | null
  language?: string | null
  description?: string | null
  level: number
  status?: string | null
  owner?: unknown
  review?: { state?: string | null } | null
  rightsStatus?: string | null
  collection?: unknown
  collectionOrder?: number | null
  updatedAt?: string
}) {
  return {
    id: book.id,
    title: book.title,
    slug: book.slug,
    subtitle: book.subtitle ?? null,
    author: book.author ?? null,
    language: book.language ?? null,
    description: book.description ?? null,
    level: levelFromId(book.level),
    published: isInPublicLibrary({
      status: book.status ?? 'draft',
      owner: book.owner,
      review: book.review,
    }),
    rightsStatus: book.rightsStatus ?? null,
    collection: (() => {
      const entry = book.collection as number | { id: number } | null | undefined
      const id = typeof entry === 'object' && entry ? entry.id : entry
      return typeof id === 'number' ? id : null
    })(),
    collectionOrder: book.collectionOrder ?? null,
    updatedAt: book.updatedAt,
  }
}
