'use server'

import config from '@payload-config'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { LEVEL_IDS } from '../../../domain/levels'
import { getCurrentUser } from '../../../lib/auth'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  defaultPlanFor,
  sourceKindOf,
} from '../../../domain/publication'
import { extractMetadata } from '../../../lib/extractMetadata'
import { objectBucket } from '../../../lib/storage'
import { logError } from '../../../lib/logError'

/**
 * Accepting a reader's own book for conversion.
 *
 * The portal from CLAUDE.md section 6.1. A scanned PDF, a text-layer
 * PDF, a DOCX or plain text all converge on the same DOCX master and
 * from there on the same EPUB and PDF variants the library offers.
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
 */

export type UploadState = { error?: string }

/**
 * What the pipeline can actually start from.
 *
 * EPUB joined this list on 2026-08-20 and needs no conversion at all —
 * it is already the reading edition, so the book is finished the moment
 * the file is filed under it (`domain/publication.ts`).
 *
 * Classification itself lives in the domain layer; this map exists only
 * to reject a file before it is stored and to name it on the way in.
 */
const ACCEPTED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/epub+zip', 'epub'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
])

export async function uploadBook(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in to upload a book.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `That file is larger than ${MAX_UPLOAD_LABEL}.` }
  }

  // The declared type first, then the filename — several browsers send
  // `application/octet-stream` for an EPUB, which says nothing.
  const kind = sourceKindOf(file.name, file.type)
  const extension = ACCEPTED.get(file.type) ?? (kind === 'epub' ? 'epub' : undefined)
  if (!extension || !kind) {
    return { error: 'Upload a PDF, a DOCX, an EPUB, or a plain text file.' }
  }

  // Read before storing, so a file we cannot parse never becomes a book
  // with nothing to show for it. Never throws; worst case is an empty
  // suggestion and a form the reader fills in themselves.
  const suggested = await extractMetadata(file)

  const payload = await getPayload({ config })

  // A slug the uploader does not choose, so one reader cannot squat on
  // a name the library might want, and two uploads of the same title
  // cannot collide.
  const jobId = crypto.randomUUID()
  const slug = `${slugify(suggested.title ?? '') || 'book'}-${jobId.slice(0, 8)}`

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Uploads are not available on this server yet.' }

  const sourceKey = `conversion/${jobId}/input/source.${extension}`
  try {
    // Streamed, not buffered. Parsing the form already holds the file
    // in memory once, and `arrayBuffer()` would make a second copy of
    // it — two copies of a 64 MB book do not fit in a Worker's 128 MB.
    await bucket.put(sourceKey, file.stream(), {
      httpMetadata: { contentType: file.type },
    })
  } catch (error) {
    logError('upload: store source in R2', error)
    return { error: 'Could not store that file. Please try again.' }
  }

  let bookId: string | number
  try {
    const created = await payload.create({
      collection: 'books',
      data: {
        title: suggested.title || file.name.replace(/\.[^.]+$/, ''),
        slug,
        author: suggested.author,
        ...(suggested.language ? { language: suggested.language as 'zh-Hant' } : {}),
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
          sourceFilename: file.name,
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
    bookId = created.id
  } catch (error) {
    logError('upload: create book record', error)
    return { error: 'Could not start the conversion. Please try again.' }
  }

  redirect(`/account/books/${bookId}`)
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
}
