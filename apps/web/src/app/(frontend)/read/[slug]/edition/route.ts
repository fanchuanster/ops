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
 * Streams a book's reading edition to the in-browser reader.
 *
 * Usually the EPUB. For a book published as it stands there is no EPUB
 * and never will be, so this serves its PDF instead — the route was
 * called `epub` until 2026-08-21 and it lied about half the library.
 * `authorizeReading` picks which one; nothing here chooses.
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

  const user = await getCurrentUser()
  const book = await getBookBySlug(slug, user)
  if (!book) return Response.json({ error: 'Not found' }, { status: 404 })

  const decision = await authorizeReading({
    payload,
    bookId: book.id,
    userId: user?.id ?? null,
  })
  if (!decision.allowed) return Response.json({ error: 'Not available' }, { status: 404 })

  const headers = {
    // The reader is told which edition it is getting; the browser has
    // to be told too, and a PDF served as an EPUB is a download prompt
    // rather than a rendered page.
    'Content-Type':
      decision.format === 'epub' ? 'application/epub+zip' : 'application/pdf',
    // The PDF is rendered by the browser's own viewer in a frame, not
    // handed over as a file. Books are read here or sent to a device;
    // they are never a file to collect (CLAUDE.md section 1).
    'Content-Disposition': 'inline',
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
