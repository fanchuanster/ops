import config from '@payload-config'
import { getPayload } from 'payload'

import { DEFAULT_BOOK_LEVEL, LEVEL_IDS } from '../../../../domain/levels'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  defaultPlanFor,
  sourceKindOf,
} from '../../../../domain/publication'
import { ADD_SOURCE_ERRORS, canAddSource } from '../../../../domain/sources'
import type { Book } from '../../../../payload-types'
import { getCurrentUser } from '../../../../lib/auth'
import { extractMetadata, r2Source } from '../../../../lib/extractMetadata'
import { logError } from '../../../../lib/logError'
import { addSourceToBook } from '../../../../lib/masterPipeline'
import { objectBucket } from '../../../../lib/storage'

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

  const url = new URL(request.url)
  const filename = (url.searchParams.get('name') ?? '').trim()
  const declaredType = (request.headers.get('content-type') ?? '').split(';')[0].trim()

  if (!filename) return fail(400, 'Choose a file to upload.')

  const declaredSize = Number(request.headers.get('content-length') ?? '')
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return fail(400, 'Choose a file to upload.')
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return fail(413, `That file is larger than ${MAX_UPLOAD_LABEL}.`)
  }

  const kind = sourceKindOf(filename, declaredType)
  const extension = ACCEPTED.get(declaredType) ?? (kind === 'epub' ? 'epub' : undefined)
  if (!extension || !kind) {
    return fail(415, 'Upload a PDF, a DOCX, an EPUB, or a plain text file.')
  }

  if (!request.body) return fail(400, 'Choose a file to upload.')

  const rawBook = url.searchParams.get('book')
  if (rawBook !== null && !/^\d+$/.test(rawBook)) return fail(400, 'No such book.')
  const bookId = rawBook === null ? null : Number(rawBook)

  const payload = await getPayload({ config })

  let target: Book | null = null
  if (bookId !== null) {
    target = await payload
      .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
      .catch(() => null)

    const ownerId = typeof target?.owner === 'object' ? target?.owner?.id : target?.owner
    if (!target || !ownerId || String(ownerId) !== String(user.id)) {
      return fail(404, 'No such book.')
    }

    const decision = canAddSource({
      kind,
      existingFormats: (target.artifacts ?? []).map((artifact) => artifact.format),
    })
    if (!decision.allowed) return fail(409, ADD_SOURCE_ERRORS[decision.reason])
  }

  const bucket = await objectBucket()
  if (!bucket) return fail(503, 'Uploads are not available on this server yet.')

  const jobId = crypto.randomUUID()
  const sourceKey = `conversion/${jobId}/input/source.${extension}`

  let size: number
  try {
    const sized = new FixedLengthStream(declaredSize)
    const stored = bucket.put(sourceKey, sized.readable, {
      httpMetadata: { contentType: declaredType || 'application/octet-stream' },
    })
    await request.body.pipeTo(sized.writable)
    const object = await stored
    size = object?.size ?? declaredSize
  } catch (error) {
    logError('upload: stream source to R2', error)
    await bucket.delete(sourceKey).catch(() => {})
    return fail(500, 'Could not store that file. Please try again.')
  }

  if (target) {
    const refusal = await addSourceToBook(payload, target, {
      kind,
      sourceKey,
      filename,
    })
    await bucket.delete(sourceKey).catch(() => {})
    if (refusal) return fail(409, refusal)
    return Response.json({ bookId: target.id })
  }

  const suggested = await extractMetadata(
    r2Source(sourceKey, { name: filename, type: declaredType, size }),
  )

  const title = (suggested.title || filename.replace(/\.[^.]+$/, '')).trim()
  const slug = `${slugify(suggested.title ?? '') || 'book'}-${jobId.slice(0, 8)}`

  const existing = await payload.find({
    collection: 'books',
    where: { title: { equals: title } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    await bucket.delete(sourceKey).catch(() => {})
    return fail(
      409,
      `“${title}” is already in the library. If this is a different edition, rename the file to say which one it is and upload it again.`,
    )
  }

  try {
    const created = await payload.create({
      collection: 'books',
      data: {
        title,
        slug,
        author: suggested.author,
        ...(suggested.language ? { language: suggested.language as 'zh-Hans' } : {}),
        estimatedPages: suggested.estimatedPages ?? undefined,
        rightsStatus: 'unknown',
        visibility: 'private',
        level: LEVEL_IDS[DEFAULT_BOOK_LEVEL],
        status: 'draft',
        owner: Number(user.id),
        review: { state: 'unsubmitted' },
        conversion: {
          state: 'draft',
          sourceKey,
          sourceFilename: filename,
          sourceKind: kind,
          plan: defaultPlanFor(kind),
          jobId,
        },
      },
      overrideAccess: true,
    })

    return Response.json({ bookId: created.id })
  } catch (error) {
    logError('upload: create book record', error)
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
