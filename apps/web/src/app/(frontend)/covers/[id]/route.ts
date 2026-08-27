/**
 * A book's cover: the image an editor or its owner uploaded, or a page
 * of the book itself.
 *
 * One address for both, since 2026-08-25. The uploaded image used to be
 * served by Payload as an ordinary Media file, which is public — see
 * `coverUploadUrl` in `domain/cover.ts` for why that was a hole once
 * uploading stopped being administrators-only. `Media` now refuses
 * everyone but an administrator and this route is the way in, which
 * means the two covers are no longer differently private.
 *
 * Streamed through the Worker like every other object in the bucket,
 * for the reason in `lib/storage.ts`: the bucket is private, there is no
 * public object URL, and there is no credential anywhere to make one.
 *
 * ## Who may see it
 *
 * Whoever may see the book. The lookup runs with `overrideAccess: false`
 * and the caller's session, so the Books access rule answers it — a
 * private upload's cover is its owner's, and an anonymous request for
 * one gets the same 404 the book page gives.
 *
 * That matters more than it looks. A cover is a picture of the front of
 * the book, which for a scan is the title page: serving it openly would
 * publish the identity of every private upload in the library to anyone
 * willing to count upwards through the ids.
 *
 * Cached `private`, so it is never held in a shared cache under a URL
 * that carries no session. Not `immutable`: a cover can be re-rendered
 * in place, and unlike an avatar there is no digest in the URL to make
 * a new one a new address.
 */

import { getFileKey } from '@payloadcms/plugin-cloud-storage/utilities'
import { getPayload } from 'payload'
import config from '@payload-config'

import {
  COVER_CANDIDATE_MAX_BYTES,
  COVER_CANDIDATE_PAGES,
  chosenCoverPage,
  coverCandidateCount,
  coverCandidateKey,
  coverKey,
  uploadedCoverId,
} from '../../../../domain/cover'
import { isAdmin } from '../../../../lib/adminAuth'
import { getCurrentUser } from '../../../../lib/auth'
import { logError } from '../../../../lib/logError'
import { revalidateCover } from '../../../../lib/revalidateCover'
import { bookStem } from '../../../../domain/bookStorage'
import { originalArtifact, readSourceKind } from '../../../../domain/publication'
import {
  artifactStream,
  localArtifactPath,
  objectBucket,
  streamLocalArtifact,
} from '../../../../lib/storage'

export const dynamic = 'force-dynamic'

/**
 * Streams an uploaded cover out of the bucket, or null if it is not
 * there.
 *
 * The key is computed with the storage plugin's own `getFileKey` rather
 * than assumed to be the filename. It is the filename today, because no
 * prefix is configured — but that is a setting in `payload.config.ts`
 * and not a fact, and a cover that silently 404s the day someone adds
 * one is a poor way to find out.
 *
 * Read with `overrideAccess: true` on purpose: `Media` refuses everyone
 * but an administrator now, and the question of who may see this
 * picture was already answered upstream by the Books access rule. This
 * is the reason that lock is safe — there is exactly one door left and
 * it checks the book.
 */
async function uploadedCoverResponse(
  payload: Awaited<ReturnType<typeof getPayload>>,
  mediaId: number,
): Promise<Response | null> {
  const media = await payload
    .findByID({ collection: 'media', id: mediaId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!media?.filename) return null

  const { fileKey } = getFileKey({
    collectionPrefix: '',
    docPrefix: (media as { prefix?: string }).prefix,
    filename: media.filename,
  })

  const headers = {
    'Content-Type': media.mimeType || 'image/jpeg',
    // Private and short, exactly as a rendered page is: the address
    // carries the media id, so a replaced cover is a new URL and this
    // hour only ever holds the picture it was fetched for.
    'Cache-Control': 'private, max-age=3600',
  }

  const stream = await artifactStream(fileKey)
  if (stream) return new Response(stream, { headers })

  // Development without Cloudflare bindings.
  const local = localArtifactPath(fileKey)
  if (!local) return null
  return new Response(streamLocalArtifact(local), { headers })
}

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

  // `?page=` asks for a rendered page explicitly, and an uploaded cover
  // does not answer it: that parameter is what the picker's thumbnails
  // are addressed by, and they have to keep showing the pages
  // themselves even while an upload is covering them.
  const asked = Number(new URL(request.url).searchParams.get('page'))
  const wantsPage = Number.isInteger(asked) && asked >= 1

  const uploaded = uploadedCoverId(book.cover)
  if (uploaded !== null && !wantsPage) {
    const streamed = await uploadedCoverResponse(payload, uploaded)
    if (streamed) return streamed
    // Fall through rather than 404: the row says there is an image and
    // the object is gone, which is a book that should still show a page
    // of itself rather than nothing at all.
  }

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
  let page = chosenCoverPage(generated)
  if (wantsPage) {
    if (asked > coverCandidateCount(generated)) return new Response(null, { status: 404 })
    page = asked
  }

  // Page one is served from the key the book records, which is what it
  // has always been. The alternatives are derived, because only page
  // one is stored — the rest are named by the same rule that told the
  // converter where to put them.
  const key = coverCandidateKey(generated.key, page)

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

  // The same stem the book's other objects use, so a cover sits beside
  // them and survives a rename exactly as they do. A book whose cover is
  // being replaced keeps the base key it already records rather than
  // filing a second set under a new name.
  const existing = book.generatedCover?.key
  const base =
    typeof existing === 'string' && existing.length > 0
      ? existing
      : coverKey(
          bookStem({
            artifacts: book.artifacts,
            sourceFilename: book.conversion?.sourceFilename,
            preferred: originalArtifact(readSourceKind(book.conversion ?? {})),
          }),
        )

  try {
    for (const [index, page] of wanted.entries()) {
      const key = coverCandidateKey(base, index + 1)
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