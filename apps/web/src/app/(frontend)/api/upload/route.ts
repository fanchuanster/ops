import config from '@payload-config'
import { getPayload } from 'payload'

import { LEVEL_IDS } from '../../../../domain/levels'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  defaultPlanFor,
  sourceKindOf,
} from '../../../../domain/publication'
import { getCurrentUser } from '../../../../lib/auth'
import { extractMetadata, r2Source } from '../../../../lib/extractMetadata'
import { logError } from '../../../../lib/logError'
import { objectBucket } from '../../../../lib/storage'

/**
 * Accepting a reader's own book for conversion.
 *
 * The portal from CLAUDE.md section 6.1. A scanned PDF, a text-layer
 * PDF, a DOCX, an EPUB or plain text all converge on the same draft,
 * and from there on the DOCX master and the editions the library
 * offers.
 *
 * This step asks for **the file and nothing else**. Whatever the file
 * already says about itself is read out of it (`lib/extractMetadata.ts`)
 * and shown on the next page for the reader to correct — asking someone
 * to retype a title their file already contains is the kind of friction
 * that stops uploads happening at all.
 *
 * The book is created as a draft: private, owned, rights `unknown`, and
 * *not* queued for conversion. Nothing is converted and nothing can be
 * submitted until the reader has seen the details and answered the
 * rights question, which is the one thing no file can answer for them.
 *
 * ---
 *
 * **Why this is a route handler and not a server action.**
 *
 * It was `actions/upload.ts` until 2026-08-24, and the file arrived as
 * `FormData`. Next parses that in full before the action's first line
 * runs, so the whole book sat in memory whatever the action then did
 * with it — which put the ceiling at 64 MB, half a Worker's 128 MB
 * budget, and made the limit a memory fact rather than a product one.
 *
 * Here the file *is* the request body. It is piped into R2 as it
 * arrives and is never resident, so a 100 MB book costs no more memory
 * than a 100 KB one. The metadata read afterwards asks storage for the
 * few ranges it needs rather than pulling the file back.
 *
 * The cost is that the browser can no longer post a plain form: the
 * upload is an explicit request from `UploadForm`, which is also what
 * makes a progress bar possible for a file this size.
 */

/** What the pipeline can start from, and the extension each is filed under. */
const ACCEPTED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/epub+zip', 'epub'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
])

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'Sign in to upload a book.')

  // The name travels as a query parameter rather than a header: book
  // filenames here are routinely Chinese, and a header is bytes with no
  // declared encoding, which is the exact problem `domain/metadata.ts`
  // exists to clean up after. A URL component is unambiguous.
  const url = new URL(request.url)
  const filename = (url.searchParams.get('name') ?? '').trim()
  const declaredType = (request.headers.get('content-type') ?? '').split(';')[0].trim()

  if (!filename) return fail(400, 'Choose a file to upload.')

  // Checked before a byte is read, so an oversized upload is refused on
  // its headers instead of after the reader has waited for all of it.
  // Cloudflare's own cap sits at this same number, so a body that lies
  // about its length is stopped by the platform rather than by us —
  // and the post-write check below catches whatever is left.
  const declaredSize = Number(request.headers.get('content-length') ?? '')
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return fail(400, 'Choose a file to upload.')
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return fail(413, `That file is larger than ${MAX_UPLOAD_LABEL}.`)
  }

  // The declared type first, then the filename — several browsers send
  // `application/octet-stream` for an EPUB, which says nothing.
  const kind = sourceKindOf(filename, declaredType)
  const extension = ACCEPTED.get(declaredType) ?? (kind === 'epub' ? 'epub' : undefined)
  if (!extension || !kind) {
    return fail(415, 'Upload a PDF, a DOCX, an EPUB, or a plain text file.')
  }

  if (!request.body) return fail(400, 'Choose a file to upload.')

  const bucket = await objectBucket()
  if (!bucket) return fail(503, 'Uploads are not available on this server yet.')

  // A job id the uploader does not choose, so one reader cannot squat
  // on a name the library might want and two uploads of the same title
  // cannot collide.
  const jobId = crypto.randomUUID()
  const sourceKey = `conversion/${jobId}/input/source.${extension}`

  let size: number
  try {
    // The whole point of this handler: the body goes to storage as it
    // arrives. Nothing here ever holds the book.
    //
    // Through a `FixedLengthStream` rather than straight from
    // `request.body`, for two reasons. R2 refuses a stream whose length
    // it does not know — "Provided readable stream must have a known
    // length" — and the request body loses that property on its way
    // through Next's layer, so piping it directly fails at runtime for
    // every upload. And the length it is fixed to is the declared one,
    // which makes the stream itself the check on `Content-Length`: a
    // body that does not deliver exactly that many bytes errors here
    // rather than being stored as a truncated book.
    const sized = new FixedLengthStream(declaredSize)
    // Started before the pipe, not awaited: `put` consumes the readable
    // half as the writable half is fed, so awaiting it first would
    // deadlock against a body nothing is reading yet.
    const stored = bucket.put(sourceKey, sized.readable, {
      httpMetadata: { contentType: declaredType || 'application/octet-stream' },
    })
    await request.body.pipeTo(sized.writable)
    const object = await stored
    size = object?.size ?? declaredSize
  } catch (error) {
    logError('upload: stream source to R2', error)
    // A partial object may exist — the failure above is as likely to be
    // a body that stopped early as a storage fault. Either way nothing
    // points at it, so it is removed rather than left to be paid for.
    await bucket.delete(sourceKey).catch(() => {})
    return fail(500, 'Could not store that file. Please try again.')
  }

  // Read after storing rather than before, because the bytes are in R2
  // and nowhere else. Never throws; worst case is an empty suggestion
  // and a form the reader fills in themselves.
  const suggested = await extractMetadata(
    r2Source(sourceKey, { name: filename, type: declaredType, size }),
  )

  const slug = `${slugify(suggested.title ?? '') || 'book'}-${jobId.slice(0, 8)}`

  try {
    const payload = await getPayload({ config })
    const created = await payload.create({
      collection: 'books',
      data: {
        title: suggested.title || filename.replace(/\.[^.]+$/, ''),
        slug,
        author: suggested.author,
        ...(suggested.language ? { language: suggested.language as 'zh-Hans' } : {}),
        // What the quota will be charged if this draft is converted.
        // Recorded now because the file is in hand now; the real count
        // replaces it when conversion finishes.
        estimatedPages: suggested.estimatedPages ?? undefined,
        // `unknown` until the reader says otherwise, and `unknown` is
        // exactly what blocks submission — so the question cannot be
        // skipped by never answering it.
        rightsStatus: 'unknown',
        // Not the uploader's to choose. Both of these are what keep an
        // upload out of the public catalog.
        visibility: 'private',
        level: LEVEL_IDS.extensive,
        status: 'draft',
        owner: Number(user.id),
        review: { state: 'unsubmitted' },
        conversion: {
          state: 'draft',
          sourceKey,
          sourceFilename: filename,
          // Recorded now, from the file that is actually in front of us.
          // Everything downstream branches on it — which formats can be
          // built, whether Adobe is called, whether a converter is
          // needed at all — and re-deriving it from a filename later is
          // one more chance to get it wrong.
          sourceKind: kind,
          plan: defaultPlanFor(kind),
          jobId,
        },
      },
      overrideAccess: true,
    })

    // The client navigates; a 3xx here would be followed by `fetch`
    // itself and the reader would never move.
    return Response.json({ bookId: created.id })
  } catch (error) {
    logError('upload: create book record', error)
    // The file is already stored, and nothing points at it now. Left
    // behind it would be a paid-for orphan nobody can reach.
    await bucket.delete(sourceKey).catch(() => {})
    return fail(500, 'Could not start the conversion. Please try again.')
  }
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
}
