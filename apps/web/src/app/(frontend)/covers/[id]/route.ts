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

import { getCurrentUser } from '../../../../lib/auth'
import { artifactStream, localArtifactPath, streamLocalArtifact } from '../../../../lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const key = book.generatedCover?.key
  if (book.generatedCover?.state !== 'ready' || !key) return new Response(null, { status: 404 })

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
