import config from '@payload-config'
import { getPayload } from 'payload'

import { authorizeReading } from '../../../../../lib/authorizeDownload'
import { getCurrentUser } from '../../../../../lib/auth'
import { getBookBySlug } from '../../../../../lib/catalog'
import {
  artifactStream,
  localArtifactPath,
  streamLocalArtifact,
} from '../../../../../lib/storage'

/**
 * Streams the EPUB to the in-browser reader.
 *
 * Deliberately not a redirect to a public object URL: epub.js fetches
 * with XHR, and a cross-origin URL would mean opening CORS on the
 * bucket. Streaming keeps the bucket private.
 *
 * No session required, because reading requires no account. The
 * authorization that does apply — rights clearance, and ownership for a
 * private upload — is re-run here rather than trusted from the page:
 * this URL is guessable, and the page having rendered a moment ago is
 * not a permission.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const payload = await getPayload({ config })

  const book = await getBookBySlug(slug)
  if (!book) return Response.json({ error: 'Not found' }, { status: 404 })

  const user = await getCurrentUser()
  const decision = await authorizeReading({
    payload,
    bookId: book.id,
    userId: user?.id ?? null,
  })
  if (!decision.allowed) return Response.json({ error: 'Not available' }, { status: 404 })

  const headers = {
    'Content-Type': 'application/epub+zip',
    // Public-domain library text served to anyone, but a private upload
    // is served only to its owner through the same route — so the safe
    // default is to let nothing cache it.
    'Cache-Control': 'private, no-store',
  }

  const stream = await artifactStream(decision.storageKey)
  if (stream) return new Response(stream, { headers })

  const filePath = localArtifactPath(decision.storageKey)
  if (!filePath) return Response.json({ error: 'Artifact missing' }, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
