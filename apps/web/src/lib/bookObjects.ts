/**
 * Reserving a name a book can keep.
 *
 * `domain/bookStorage.ts` says what a book's objects should be called;
 * this is the one part of that decision needing the bucket to answer.
 *
 * Uploaded filenames are not unique — two readers both have a
 * `scan.pdf` — so the name a book wants is routinely already taken.
 * That is ordinary rather than an error: the second book becomes
 * `scan-2`, the third `scan-3`.
 *
 * **The number belongs to the book, not to each file.** A stem counts as
 * taken when *any* of the keys it would occupy exists, so a book cannot
 * end up as `scan.docx` beside `scan-2.epub`. Reserving the whole
 * footprint once is what makes "every variation shares the name" true
 * for the book's whole life rather than only at its first write.
 *
 * The rule underneath is the one that matters: **a write never lands on
 * an object this book does not already own.** Overwriting one would
 * serve the wrong text under the right title, with no error anywhere.
 */

import { numberedStem, stemFootprint } from '../domain/bookStorage'
import { objectBucket } from './storage'

/**
 * How many numbers to try before giving up rather than looping.
 *
 * Generous, because the collisions this resolves are real names people
 * actually use — a bucket holding twenty `scan.pdf`s is not a pathology.
 */
const MAX_ATTEMPTS = 50

/**
 * The stem to use, given the one the uploaded filename suggests.
 *
 * `owned` is every key this book already records. A key it owns does not
 * make a stem taken — that is the book's own object, and re-reserving
 * its own name is exactly what a rebuild must do.
 *
 * With no bucket (running without Cloudflare) the wanted stem is
 * returned as-is: there is nothing to collide with, and the caller is
 * about to fail on the write anyway.
 */
export async function freeStem({
  wanted,
  owned,
}: {
  wanted: string
  owned?: readonly (string | null | undefined)[]
}): Promise<string> {
  const bucket = await objectBucket()
  if (!bucket) return wanted

  const mine = new Set((owned ?? []).filter((key): key is string => typeof key === 'string'))

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = numberedStem(wanted, attempt)
    // `head` rather than `get`: this asks whether an object exists
    // without moving its bytes, which for a 60 MB scan is the whole
    // difference between a check and a download.
    const taken = await Promise.all(
      stemFootprint(candidate).map(async (key) =>
        mine.has(key) ? false : (await bucket.head(key)) !== null,
      ),
    )
    if (!taken.some(Boolean)) return candidate
  }

  throw new Error(`no free storage name for ${wanted} after ${MAX_ATTEMPTS} attempts`)
}
