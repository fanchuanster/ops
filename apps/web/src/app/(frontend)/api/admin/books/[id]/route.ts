import { APIError } from 'payload'
import type { Payload } from 'payload'

import { parseBookUpdate } from '../../../../../../domain/adminApi'
import { levelFromId } from '../../../../../../domain/levels'
import { adminFromRequest, unauthorized } from '../../../../../../lib/apiAuth'
import { logError } from '../../../../../../lib/logError'
import { revalidateCuration } from '../../shared'

/**
 * One book, for a machine.
 *
 * `GET` to read it, `PATCH` to change it. Curation from a script — a
 * bulk re-shelving, a levelling pass, an editor's own tooling — without
 * a browser and without reimplementing any of the rules.
 *
 * ## What it is not
 *
 * Not a second way to publish. `visibility` is writable, but
 * `enforcePublicationReview` runs on the write exactly as it does for
 * the admin UI and for the REST API, so a book whose rights do not permit
 * distribution is refused here too. That hook is the guarantee; this
 * route does not re-check it, because a second copy of the rule is a
 * second thing to keep in step.
 *
 * Not a way to fabricate history either. `owner`, `review`,
 * `conversion`, `artifacts` and the derived `priceCredits` /
 * `pageCount` are absent from the allowlist in `domain/adminApi.ts` —
 * they belong to the uploader, the review queue, or the pipeline.
 *
 * ## Authentication
 *
 * A per-user API key (`Authorization: users API-Key …`) or an ordinary
 * session, resolved by Payload either way, and then the `admin` role.
 * Per-user rather than one shared secret because publishing records
 * *who* approved a book, and a token with no owner has no answer.
 *
 * The write itself runs with `overrideAccess: true` and the resolved
 * administrator as `user`. That pairing is deliberate: the role check
 * above has already answered "may this caller write", and passing the
 * user is what lets the collection hooks see whose act it is.
 */

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

  // `title` and `slug` are both uniquely indexed, and the constraint
  // surfaces from D1 as a raw failed-query error with no marker in it —
  // no field, no code, nothing to branch on. Left to the catch below it
  // becomes a 500, which tells a script the server broke when in fact
  // the script asked for something taken. So the collision is looked up
  // first, which costs one indexed query and buys a 409 that names the
  // field.
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
      // Whose act this is. The hooks read it — `enforcePublicationReview`
      // to decide whether an administrator is publishing, and to record
      // the approval that implies.
      user: admin,
    })
    await revalidateCuration()
    return Response.json({ book: serialize(updated) })
  } catch (error) {
    // A hook's refusal is the caller's fault and carries a sentence
    // worth passing on — the rights gate in particular. Anything else
    // is ours and says nothing useful to a client.
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.status || 400 })
    }
    logError('api.admin.books.patch', error)
    return Response.json({ error: 'That update could not be saved.' }, { status: 500 })
  }
}

/**
 * Whether another book already holds the unique values being claimed.
 *
 * One query for both fields rather than one each: they are separately
 * indexed, so an `or` still uses them, and a PATCH setting both should
 * not cost two round trips to D1 — which on a Worker is two waits.
 *
 * Scoped with `not_equals` on the book itself, or writing a book's own
 * title back to it unchanged would report a collision with itself.
 */
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

/**
 * What a caller gets back.
 *
 * Narrowed on purpose rather than returning the document. A book row
 * carries `conversion.sourceKey`, artifact storage keys and the review
 * note, none of which a curation client needs — and a response shaped
 * like the allowlist is one a client can send straight back as a PATCH.
 */
function serialize(book: {
  id: number | string
  title: string
  slug: string
  subtitle?: string | null
  originalTitle?: string | null
  author?: string | null
  translator?: string | null
  language?: string | null
  description?: string | null
  level: number
  visibility?: string | null
  rightsStatus?: string | null
  collection?: unknown
  updatedAt?: string
}) {
  return {
    id: book.id,
    title: book.title,
    slug: book.slug,
    subtitle: book.subtitle ?? null,
    originalTitle: book.originalTitle ?? null,
    author: book.author ?? null,
    translator: book.translator ?? null,
    language: book.language ?? null,
    description: book.description ?? null,
    // The name, not the stored id — the same vocabulary the PATCH takes.
    level: levelFromId(book.level),
    visibility: book.visibility ?? null,
    rightsStatus: book.rightsStatus ?? null,
    collection: (() => {
      const entry = book.collection as number | { id: number } | null | undefined
      const id = typeof entry === 'object' && entry ? entry.id : entry
      return typeof id === 'number' ? id : null
    })(),
    updatedAt: book.updatedAt,
  }
}
