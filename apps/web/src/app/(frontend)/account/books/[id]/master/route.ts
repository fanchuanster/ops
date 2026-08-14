import config from '@payload-config'
import { getPayload } from 'payload'

import { filenameFor } from '../../../../../../lib/authorizeDownload'
import { getCurrentUser } from '../../../../../../lib/auth'
import {
  artifactStream,
  localArtifactPath,
  streamLocalArtifact,
} from '../../../../../../lib/storage'

/**
 * The DOCX master of your own upload.
 *
 * The master is never a reader download — it is the editorial source of
 * truth, and `downloadable: false` on the artifact keeps it out of every
 * delivery path. This route is the one exception and it is a different
 * thing: the owner of a private upload editing their own book.
 *
 * That is what makes a draft a workspace rather than a preview. A
 * conversion from a scan is a first pass, not a finished edition; the
 * uploader is the one who can see what the OCR got wrong, and they need
 * the file to fix it.
 *
 * Ownership is the whole access rule here, and it is checked against
 * the session rather than anything in the URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 401 })

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: Number(id), depth: 0, overrideAccess: true })
    .catch(() => null)

  // Not yours and not there are the same answer.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return new Response(null, { status: 404 })
  }

  const master = (book.artifacts ?? []).find((a) => a.format === 'docx')
  if (!master?.storageKey) return new Response(null, { status: 404 })

  const headers = {
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="${filenameFor(book.title, 'docx')}"`,
    'Cache-Control': 'private, no-store',
  }

  const stream = await artifactStream(master.storageKey)
  if (stream) return new Response(stream, { headers })

  const filePath = localArtifactPath(master.storageKey)
  if (!filePath) return new Response(null, { status: 502 })
  return new Response(streamLocalArtifact(filePath), { headers })
}
