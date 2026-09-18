import config from '@payload-config'
import { getPayload } from 'payload'

import { coverSourceFrom } from '../../../../../domain/cover'
import { isAdmin } from '../../../../../lib/adminAuth'
import { getCurrentUser } from '../../../../../lib/auth'
import {
  artifactStream,
  localArtifactPath,
  streamLocalArtifact,
} from '../../../../../lib/storage'

export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 404 })

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: Number(id), depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  if (!book || (!mine && !isAdmin(user))) return new Response(null, { status: 404 })

  const source = coverSourceFrom(book.artifacts ?? [])
  if (!source?.storageKey) return new Response(null, { status: 404 })

  const format = source.format

  const headers = {
    'Content-Type': TYPES[format] ?? 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Cover-Source': format,
  }

  const stream = await artifactStream(source.storageKey)
  if (stream) return new Response(stream, { headers })

  const filePath = localArtifactPath(source.storageKey)
  if (!filePath) return new Response(null, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
