import config from '@payload-config'
import { getPayload } from 'payload'

import { authorizeDownload } from '../../../../../../lib/authorizeDownload'
import { getBookBySlug, getPartsForBook } from '../../../../../../lib/catalog'
import {
  artifactStream,
  isObjectStorageConfigured,
  localArtifactPath,
  streamLocalArtifact,
} from '../../../../../../lib/storage'

/**
 * Streams the EPUB to the in-browser reader.
 *
 * Deliberately not a redirect to a signed URL: epub.js fetches ranges
 * with XHR, and a cross-origin URL would mean opening CORS on the
 * bucket. Streaming keeps the bucket private and keeps this request
 * authenticated by the session cookie the reader already holds.
 *
 * Re-authorized on every request rather than trusting that the page
 * rendered — this URL is guessable, and the page having been served a
 * moment ago is not a permission.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; order: string }> },
) {
  const { slug, order } = await params
  const payload = await getPayload({ config })

  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 })

  const book = await getBookBySlug(slug)
  if (!book) return Response.json({ error: 'Not found' }, { status: 404 })

  const parts = await getPartsForBook(book.id)
  const part = parts.find((p) => p.order === Number(order))
  if (!part) return Response.json({ error: 'Not found' }, { status: 404 })

  const decision = await authorizeDownload({
    payload,
    partId: String(part.id),
    format: 'epub',
    userId: user.id,
    enforceDownloadLimit: false,
  })
  if (!decision.allowed) {
    return Response.json({ error: 'Not available' }, { status: 403 })
  }

  const headers = {
    'Content-Type': 'application/epub+zip',
    // Private: this response is scoped to one authenticated reader and
    // must never be held in a shared cache.
    'Cache-Control': 'private, no-store',
  }

  if (isObjectStorageConfigured()) {
    const stream = await artifactStream(decision.storageKey)
    if (!stream) return Response.json({ error: 'Artifact missing' }, { status: 502 })
    return new Response(stream, { headers })
  }

  const filePath = localArtifactPath(decision.storageKey)
  if (!filePath) return Response.json({ error: 'Artifact missing' }, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
