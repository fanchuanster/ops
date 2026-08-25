/**
 * The file a book's cover is rendered from, for the browser doing the
 * rendering.
 *
 * Covers are made in the browser (`lib/client/coverImages.ts`), which
 * is easy at upload time — the file is right there — and needs help for
 * a book already in the library, whose PDF is in a private bucket. This
 * is that help: the book's best cover source, streamed through the
 * Worker like every other object.
 *
 * **Owner or administrator, and no one else.** Deliberately not the
 * reading rule: `/read/<slug>/edition` serves a public book to anyone
 * because reading needs no account, and this serves the *original* —
 * for a private upload that is the reader's own file, and for a public
 * one it is a whole book handed over as bytes rather than read in
 * place, which is the thing CLAUDE.md section 1 says NobleSee does not
 * do. Making a cover is an editorial act, so it gets an editorial rule.
 *
 * No credit is spent and no delivery recorded: nothing here is a
 * download in the sense `authorizeDownload` means. That is exactly why
 * the access rule above has to be narrow.
 */

import config from '@payload-config'
import { getPayload } from 'payload'

import { coverSourceFormat } from '../../../../../domain/cover'
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

  // Not found and not yours are the same answer.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  if (!book || (!mine && !isAdmin(user))) return new Response(null, { status: 404 })

  const artifacts = book.artifacts ?? []
  const format = coverSourceFormat(artifacts.map((artifact) => artifact.format))
  const source = artifacts.find((artifact) => artifact.format === format)
  if (!format || !source?.storageKey) return new Response(null, { status: 404 })

  const headers = {
    'Content-Type': TYPES[format] ?? 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    // Which of the two the browser is getting, so it knows whether to
    // rasterize pages or open a zip without sniffing the bytes.
    'X-Cover-Source': format,
  }

  const stream = await artifactStream(source.storageKey)
  if (stream) return new Response(stream, { headers })

  const filePath = localArtifactPath(source.storageKey)
  if (!filePath) return new Response(null, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
