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

const EDITION_CONTENT_TYPES = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
} as const

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
    'Content-Type': EDITION_CONTENT_TYPES[decision.format],
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
  }

  const stream = await artifactStream(decision.storageKey)
  if (stream) return new Response(stream, { headers })

  const filePath = localArtifactPath(decision.storageKey)
  if (!filePath) return Response.json({ error: 'Artifact missing' }, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
