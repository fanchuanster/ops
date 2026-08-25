/**
 * A book's generated cover — page one, rendered by the converter.
 *
 * Streamed through the Worker like every other object in the bucket,
 * for the reason in `lib/storage.ts`: the bucket is private, there is no
 * public object URL, and there is no credential anywhere to make one.
 *
 * ## Who may see it
 *
 * Whoever may see the book. The lookup runs with `overrideAccess: false`
 * and the caller's session, so the Books access rule answers it — a
 * private upload's first page is its owner's, and an anonymous request
 * for one gets the same 404 the book page gives.
 *
 * That matters more than it looks. A cover is a picture of the first
 * page of the book, which for a scan is the title page: serving it
 * openly would publish the identity of every private upload in the
 * library to anyone willing to count upwards through the ids.
 *
 * Cached `private`, so it is never held in a shared cache under a URL
 * that carries no session. Not `immutable`: a cover can be re-rendered
 * in place, and unlike an avatar there is no digest in the URL to make
 * a new one a new address.
 */

import { getPayload } from 'payload'
import config from '@payload-config'

import {
  COVER_CANDIDATE_MAX_BYTES,
  COVER_CANDIDATE_PAGES,
  chosenCoverPage,
  coverCandidateCount,
  coverKey,
} from '../../../../domain/cover'
import { isAdmin } from '../../../../lib/adminAuth'
import { getCurrentUser } from '../../../../lib/auth'
import { logError } from '../../../../lib/logError'
import { revalidateCover } from '../../../../lib/revalidateCover'
import {
  artifactStream,
  localArtifactPath,
  objectBucket,
  streamLocalArtifact,
} from '../../../../lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const reader = await getCurrentUser()
  const payload = await getPayload({ config })

  const found = await payload
    .find({
      collection: 'books',
      where: { id: { equals: id } },
      limit: 1,
      depth: 0,
      overrideAccess: false,
      user: reader ?? undefined,
    })
    .catch(() => null)

  const book = found?.docs[0]
  if (!book) return new Response(null, { status: 404 })

  const generated = book.generatedCover ?? {}
  if (generated.state !== 'ready' || !generated.key) return new Response(null, { status: 404 })

  // `?page=` asks for one particular candidate — what the picker draws
  // its thumbnails from, and where a chosen page other than the first
  // is served. Without it the book's own choice answers, so every link
  // written before candidates existed still resolves.
  //
  // Validated against the count this book actually has rather than
  // against the ceiling: an unrendered page is a 404, not a stream of
  // whatever happens to be at that key.
  const asked = Number(new URL(request.url).searchParams.get('page'))
  let page = chosenCoverPage(generated)
  if (Number.isInteger(asked) && asked >= 1) {
    if (asked > coverCandidateCount(generated)) return new Response(null, { status: 404 })
    page = asked
  }

  // Page one is served from the key the book records, which is what it
  // has always been. The alternatives are derived, because only page
  // one is stored — the rest are named by the same rule that told the
  // converter where to put them.
  const key = page <= 1 ? generated.key : coverKey(id, page)

  const stream = await artifactStream(key)
  if (stream) {
    return new Response(stream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  // Development without Cloudflare bindings.
  const local = localArtifactPath(key)
  if (!local) return new Response(null, { status: 404 })

  return new Response(streamLocalArtifact(local), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}


/**
 * Stores the candidates a browser rendered for this book.
 *
 * The other half of `lib/client/coverImages.ts`. The pages arrive as
 * JPEGs, in page order, from the uploader's browser at upload time or
 * from an editor's browser for a book already in the library.
 *
 * **The keys are ours, not the client's.** The old converter reported
 * where it had written, which needed a containment check on every key
 * it named; here the position in the list is the page number and the
 * key is derived from it, so a caller cannot name a path at all. That
 * is not a small difference — it is a whole class of bug that no longer
 * has a door.
 *
 * Owner or administrator, the same rule as choosing which page a book
 * wears (`actions/cover.ts`), for the same reason: a cover is not a
 * claim about the book, only which photograph of it looks right.
 *
 * Replaces whatever was there. Re-rendering is the fix for a cover that
 * came out wrong, and a partial set left over from a previous run would
 * leave `candidates` counting pages that no longer exist — so the page
 * choice goes back to one with it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 })

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: Number(id), depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  if (!book || (!mine && !isAdmin(user))) {
    return Response.json({ error: 'Not found.' }, { status: 404 })
  }

  const form = await request.formData().catch(() => null)
  const pages = (form?.getAll('pages') ?? []).filter(
    (entry): entry is File => entry instanceof File,
  )
  if (pages.length === 0) return Response.json({ error: 'No pages sent.' }, { status: 400 })

  // JPEG only, because these are ours: the browser renders to JPEG and
  // nothing else should be arriving. An allowlist of one is the
  // narrowest this can be, and it keeps the SVG-is-a-script problem
  // that `COVER_MIME_TYPES` exists for permanently out of this door.
  for (const page of pages.slice(0, COVER_CANDIDATE_PAGES)) {
    if (page.type !== 'image/jpeg') {
      return Response.json({ error: 'Pages must be JPEG.' }, { status: 415 })
    }
    if (page.size === 0 || page.size > COVER_CANDIDATE_MAX_BYTES) {
      return Response.json({ error: 'That page is the wrong size.' }, { status: 413 })
    }
  }

  const bucket = await objectBucket()
  if (!bucket) return Response.json({ error: 'Storage is not available.' }, { status: 503 })

  const wanted = pages.slice(0, COVER_CANDIDATE_PAGES)
  const written: string[] = []

  try {
    for (const [index, page] of wanted.entries()) {
      const key = coverKey(book.id, index + 1)
      await bucket.put(key, await page.arrayBuffer(), {
        httpMetadata: { contentType: 'image/jpeg' },
      })
      written.push(key)
    }

    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        generatedCover: {
          state: 'ready',
          key: written[0],
          candidates: written.length,
          page: 1,
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('cover.store', error)
    return Response.json({ error: 'Those pages could not be stored.' }, { status: 502 })
  }

  revalidateCover(book.slug)
  return Response.json({ candidates: written.length })
}