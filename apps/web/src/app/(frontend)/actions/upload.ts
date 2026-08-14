'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { LEVEL_IDS } from '../../../domain/levels'
import { getCurrentUser } from '../../../lib/auth'
import { objectBucket } from '../../../lib/storage'

/**
 * Accepting a reader's own book for conversion.
 *
 * The portal from CLAUDE.md section 6.1. A scanned PDF, a text-layer
 * PDF, a DOCX or plain text all converge on the same DOCX master and
 * from there on the same EPUB and PDF variants the library offers.
 *
 * Three rules are enforced here and are not negotiable:
 *
 *   1. **Private by default.** The book is created with
 *      `visibility: private` and an owner. Nothing an uploader can send
 *      puts a book in the public library; that needs an administrator's
 *      approval *and* a rights status that permits distribution, which
 *      `domain/moderation.ts` decides.
 *   2. **The uploader declares the rights.** They are the only person
 *      who knows where the file came from, and this is the one moment
 *      in the flow when the question is easy to answer. `unknown` is
 *      refused outright rather than accepted and quietly stuck.
 *   3. **Reading level and visibility are not theirs to set.** An
 *      uploader who could would walk their upload into the front of the
 *      library.
 */

export type UploadState = { error?: string }

/** What the pipeline can actually start from. */
const ACCEPTED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
])

/** Large enough for a scanned book, small enough to bound a Worker. */
const MAX_BYTES = 64 * 1024 * 1024

/**
 * Rights an uploader may claim for their own material.
 *
 * `user_owned` says "I have a copy". It never clears public
 * distribution — see domain/rights.ts — which is exactly why it is safe
 * to let the uploader pick it.
 */
export const UPLOADER_RIGHTS = [
  { value: 'user_owned', label: 'I own a copy of this book (stays private to me)' },
  { value: 'public_domain', label: 'It is in the public domain' },
  { value: 'permission_granted', label: 'I have the rights holder’s permission' },
  { value: 'licensed', label: 'It is licensed for redistribution' },
] as const

export async function uploadBook(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in to upload a book.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' }
  if (file.size > MAX_BYTES) {
    return { error: `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` }
  }

  const extension = ACCEPTED.get(file.type)
  if (!extension) {
    return { error: 'Upload a PDF, a DOCX, or a plain text file.' }
  }

  const title = String(formData.get('title') || '').trim()
  if (!title) return { error: 'Give the book a title.' }

  const rightsStatus = String(formData.get('rightsStatus') || '')
  if (!UPLOADER_RIGHTS.some((option) => option.value === rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }

  const collectionIds = formData
    .getAll('collections')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)

  const payload = await getPayload({ config })

  // A slug the uploader does not choose, so one reader cannot squat on
  // a name the library might want, and two uploads of the same title
  // cannot collide.
  const jobId = crypto.randomUUID()
  const slug = `${slugify(title) || 'book'}-${jobId.slice(0, 8)}`

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Uploads are not available on this server yet.' }

  const sourceKey = `conversion/${jobId}/input/source.${extension}`
  try {
    await bucket.put(sourceKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })
  } catch {
    return { error: 'Could not store that file. Please try again.' }
  }

  try {
    await payload.create({
      collection: 'books',
      data: {
        title,
        slug,
        author: String(formData.get('author') || '').trim() || undefined,
        rightsStatus: rightsStatus as 'user_owned',
        // Not the uploader's to choose. Both of these are what keep an
        // upload out of the public catalog.
        visibility: 'private',
        level: LEVEL_IDS.extensive,
        status: 'in_production',
        owner: Number(user.id),
        review: { state: 'unsubmitted' },
        collections: collectionIds,
        conversion: {
          state: 'queued',
          sourceKey,
          sourceFilename: file.name,
          jobId,
        },
      },
      overrideAccess: true,
    })
  } catch {
    return { error: 'Could not start the conversion. Please try again.' }
  }

  revalidatePath('/account/books')
  redirect('/account/books')
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
}
