import config from '@payload-config'
import { getPayload } from 'payload'

import {
  authorizeDownload,
  markPartStarted,
  recordDownload,
} from '../../../../../lib/authorizeDownload'
import {
  isObjectStorageConfigured,
  localArtifactPath,
  signedArtifactUrl,
  streamLocalArtifact,
} from '../../../../../lib/storage'

/**
 * The authorized download path.
 *
 * Every refusal is decided server-side before a single byte is
 * reachable. The response is a redirect to a 60-second signed URL, or
 * — when object storage is not configured — a stream through this
 * process. In neither case is the object publicly addressable.
 *
 * The ledger row is written *before* the redirect is issued. Writing it
 * after would let a reader spend a slot without it being counted if the
 * response were abandoned, which is the direction that breaks the limit.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partId: string; format: string }> },
) {
  const { partId, format } = await params
  const payload = await getPayload({ config })

  const { user } = await payload.auth({ headers: _request.headers })
  if (!user) {
    // Readers arriving from a book page should land somewhere useful,
    // not on a bare 401. A relative Location keeps this correct on
    // whatever origin actually served the request — building it from
    // the configured public URL would send a local or preview visitor
    // to production.
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/login?next=${encodeURIComponent(`/download/${partId}/${format}`)}`,
      },
    })
  }

  const decision = await authorizeDownload({
    payload,
    partId,
    format,
    userId: user.id,
  })

  if (!decision.allowed) {
    const { refusal } = decision
    switch (refusal.reason) {
      case 'not_found':
      case 'format_unavailable':
        return Response.json({ error: 'Not found' }, { status: 404 })
      case 'authentication_required':
        return Response.json({ error: 'Sign in required' }, { status: 401 })
      case 'rights_not_cleared':
        return Response.json(
          { error: 'This book is not cleared for distribution.' },
          { status: 403 },
        )
      case 'not_owner':
        return Response.json({ error: 'Not found' }, { status: 404 })
      case 'part_not_released':
        return Response.json(
          {
            error: 'This part has not opened for you yet.',
            opensAt: refusal.opensAt?.toISOString(),
          },
          { status: 403 },
        )
      case 'limit_reached': {
        const seconds = Math.max(
          1,
          Math.ceil((refusal.retryAfter.getTime() - Date.now()) / 1000),
        )
        return Response.json(
          {
            error: 'Download limit reached. It counts books, not files.',
            retryAfter: refusal.retryAfter.toISOString(),
          },
          { status: 429, headers: { 'Retry-After': String(seconds) } },
        )
      }
    }
  }

  await recordDownload(payload, {
    userId: user.id,
    bookId: decision.bookId,
    partId: decision.partId,
    format,
  })

  // Downloading a part counts as starting it, which starts the clock on
  // the next one.
  const part = await payload.findByID({
    collection: 'parts',
    id: String(decision.partId),
    depth: 0,
    overrideAccess: true,
  })
  await markPartStarted(payload, {
    userId: user.id,
    bookId: decision.bookId,
    partOrder: part.order,
  })

  if (isObjectStorageConfigured()) {
    const url = await signedArtifactUrl(decision.storageKey, decision.filename)
    return Response.redirect(url, 303)
  }

  const filePath = localArtifactPath(decision.storageKey)
  if (!filePath) {
    return Response.json({ error: 'Artifact is missing from storage.' }, { status: 502 })
  }
  return new Response(streamLocalArtifact(filePath), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${decision.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
