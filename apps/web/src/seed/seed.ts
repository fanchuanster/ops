/**
 * Seeds the public catalog.
 *
 * Idempotent: everything is matched on slug and updated in place, so
 * running it twice never duplicates a book. That matters because it is
 * wired into `docker compose up` as a one-shot service.
 *
 * No data is migrated from the previous WordPress implementation — the
 * books below are re-declared here from scratch. The `storageKey`
 * values, however, point at artifacts that already exist in our own R2
 * bucket, so the download path has real files to serve instead of
 * dangling references. Regenerate them with
 * `tools/generate-seed-content.py` if they are ever lost.
 *
 * Run with:  npm run seed
 */

import config from '@payload-config'
import { getPayload } from 'payload'

import { LEVEL_IDS } from '../domain/levels'

type FormatKey = 'docx' | 'epub' | 'pdf_standard' | 'pdf_large' | 'pdf_xl'

interface SeedPart {
  title: string
  order: number
  /** Prefix in object storage; the five artifacts hang off it. */
  keyPrefix: string
}

interface SeedBook {
  slug: string
  title: string
  originalTitle: string
  author: string
  translator: string
  language: 'zh-Hant' | 'zh-Hans' | 'en' | 'zh-en'
  description: string
  collections: string[]
  stagedRelease?: { enabled: boolean; unlockDelayHours: number }
  parts: SeedPart[]
}

/** Filenames are fixed per format, so only the prefix varies per part. */
const ARTIFACT_FILES: Record<FormatKey, string> = {
  docx: 'master.docx',
  epub: 'book.epub',
  pdf_standard: 'standard.pdf',
  pdf_large: 'large.pdf',
  pdf_xl: 'xl.pdf',
}

const COLLECTIONS: { title: string; slug: string; description?: string; parent?: string }[] = [
  {
    title: 'Chinese Classics',
    slug: 'chinese-classics',
    description: 'Foundational texts of Chinese thought, in the original alongside translation.',
  },
  {
    title: 'Chinese History',
    slug: 'chinese-history',
    description: 'Histories and historical records.',
  },
  {
    title: 'Chinese Wisdom',
    slug: 'chinese-wisdom',
    description: 'Works on character, judgement and how to live.',
  },
  {
    title: 'Philosophy & Wisdom',
    slug: 'philosophy-wisdom',
  },
  {
    title: 'Personal Development',
    slug: 'personal-development',
  },
  {
    title: 'Authors',
    slug: 'authors',
    description: 'Browse by author.',
  },
  { title: 'Nan Huaijin', slug: 'nan-huaijin', parent: 'authors' },
  { title: 'Zhang Tianliang', slug: 'zhang-tianliang', parent: 'authors' },
]

const BOOKS: SeedBook[] = [
  {
    slug: 'tao-te-ching',
    title: 'Tao Te Ching',
    originalTitle: '道德經',
    author: 'Laozi (老子)',
    translator: 'James Legge (1891)',
    language: 'zh-en',
    description:
      'One of the foundational texts of Chinese philosophy, traditionally attributed to Laozi. This edition presents James Legge’s 1891 translation, which is in the public domain, alongside the original Chinese text.',
    collections: ['chinese-classics', 'philosophy-wisdom'],
    parts: [{ title: 'Chapter 1 / 第一章', order: 1, keyPrefix: 'books/4/parts/11' }],
  },
  {
    slug: 'analects',
    title: 'The Analects',
    originalTitle: '論語',
    author: 'Confucius (孔子)',
    translator: 'James Legge (1893)',
    language: 'zh-en',
    description:
      'The recorded sayings of Confucius and his disciples, compiled by later followers — among the most influential works in Chinese thought on learning, character, and how to live well. This edition presents James Legge’s 1893 translation, which is in the public domain, alongside the original Chinese.',
    collections: ['chinese-classics', 'personal-development'],
    // Multi-part, so staged release is exercised by real seed data.
    stagedRelease: { enabled: true, unlockDelayHours: 24 },
    parts: [
      { title: 'Book I — 學而 (Xue Er)', order: 1, keyPrefix: 'books/18/parts/20' },
      { title: 'Book II — 為政 (Wei Zheng)', order: 2, keyPrefix: 'books/18/parts/26' },
      { title: 'Book III — 八佾 (Ba Yi)', order: 3, keyPrefix: 'books/18/parts/32' },
    ],
  },
]

function artifactsFor(part: SeedPart) {
  return (Object.keys(ARTIFACT_FILES) as FormatKey[]).map((format) => ({
    format,
    storageKey: `${part.keyPrefix}/${ARTIFACT_FILES[format]}`,
    // The editable master is an editorial artifact, not a reader
    // download — it is the source of truth and stays internal.
    downloadable: format !== 'docx',
  }))
}

async function seed() {
  const payload = await getPayload({ config })

  // --- collections, parents first so children can point at them ------
  const collectionIds = new Map<string, number>()
  for (const spec of [...COLLECTIONS].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0))) {
    const existing = await payload.find({
      collection: 'book-collections',
      where: { slug: { equals: spec.slug } },
      limit: 1,
    })

    const data = {
      title: spec.title,
      slug: spec.slug,
      description: spec.description,
      parent: spec.parent ? collectionIds.get(spec.parent) : undefined,
    }

    const doc = existing.docs[0]
      ? await payload.update({ collection: 'book-collections', id: existing.docs[0].id, data })
      : await payload.create({ collection: 'book-collections', data })

    collectionIds.set(spec.slug, doc.id)
    console.log(`${existing.docs[0] ? 'updated' : 'created'} collection: ${spec.title}`)
  }

  // --- books and their parts -----------------------------------------
  for (const spec of BOOKS) {
    const existing = await payload.find({
      collection: 'books',
      where: { slug: { equals: spec.slug } },
      limit: 1,
    })

    const data = {
      title: spec.title,
      slug: spec.slug,
      originalTitle: spec.originalTitle,
      author: spec.author,
      translator: spec.translator,
      language: spec.language,
      description: spec.description,
      // Both seed titles are pre-1928 translations of pre-modern texts.
      rightsStatus: 'public_domain' as const,
      visibility: 'public' as const,
      // The Analects and the Tao Te Ching are the core of what NobleSee
      // exists to make readable, so they sit at the essential level and
      // are visible however narrowly a reader is browsing.
      level: LEVEL_IDS.essential,
      // Library content entered by staff, not a reader submission —
      // there is nothing to review. See domain/moderation.ts.
      review: { state: 'unsubmitted' as const },
      status: 'published' as const,
      stagedRelease: spec.stagedRelease ?? { enabled: false, unlockDelayHours: 24 },
      collections: spec.collections
        .map((slug) => collectionIds.get(slug))
        .filter((id): id is number => id !== undefined),
    }

    const book = existing.docs[0]
      ? await payload.update({ collection: 'books', id: existing.docs[0].id, data })
      : await payload.create({ collection: 'books', data })

    console.log(`${existing.docs[0] ? 'updated' : 'created'} book: ${spec.title}`)

    for (const part of spec.parts) {
      // Matched on (book, order): a part's title may be re-edited, its
      // position in the book is what identifies it.
      const existingPart = await payload.find({
        collection: 'parts',
        where: { and: [{ book: { equals: book.id } }, { order: { equals: part.order } }] },
        limit: 1,
      })

      const partData = {
        title: part.title,
        book: book.id,
        order: part.order,
        status: 'published' as const,
        artifacts: artifactsFor(part),
      }

      if (existingPart.docs[0]) {
        await payload.update({ collection: 'parts', id: existingPart.docs[0].id, data: partData })
      } else {
        await payload.create({ collection: 'parts', data: partData })
      }
      console.log(`  part ${part.order}: ${part.title}`)
    }
  }

  console.log('Seed complete.')
}

await seed()
process.exit(0)
