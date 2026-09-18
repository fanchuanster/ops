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
import { MEDIA_PREFIX } from '../../../../domain/bookStorage'
import {
  artifactStream,
  localArtifactPath,
  objectBucket,
  streamLocalArtifact,
} from '../../../../lib/storage'

export const dynamic = 'force-dynamic'

async function uploadedCoverResponse(
  payload: Awaited<ReturnType<typeof getPayload>>,
  mediaId: number,
): Promise<Response | null> {
  const media = await payload
    .findByID({ collection: 'media', id: mediaId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!media?.filename) return null

  const { fileKey } = getFileKey({
    collectionPrefix: MEDIA_PREFIX,
    docPrefix: (media as { prefix?: string }).prefix,
    filename: media.filename,
  })

  const headers = {
    'Content-Type': media.mimeType || 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
  }

  const stream = await artifactStream(fileKey)
  if (stream) return new Response(stream, { headers })

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

  const asked = Number(new URL(request.url).searchParams.get('page'))
  const wantsPage = Number.isInteger(asked) && asked >= 1

  const uploaded = uploadedCoverId(book.cover)
  if (uploaded !== null && !wantsPage) {
    const streamed = await uploadedCoverResponse(payload, uploaded)
    if (streamed) return streamed
  }

  const generated = book.generatedCover ?? {}
  if (generated.state !== 'ready' || !generated.key) return new Response(null, { status: 404 })

  let page = chosenCoverPage(generated)
  if (wantsPage) {
    if (asked > coverCandidateCount(generated)) return new Response(null, { status: 404 })
    page = asked
  }

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

  const local = localArtifactPath(key)
  if (!local) return new Response(null, { status: 404 })

  return new Response(streamLocalArtifact(local), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

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

  const existing = book.generatedCover?.key
  const base =
    typeof existing === 'string' && existing.length > 0
      ? existing
      : coverKey(book.slug)

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