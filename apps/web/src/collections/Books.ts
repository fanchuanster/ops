import type { Access, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import { BOOK_LEVELS, DEFAULT_BOOK_LEVEL, LEVEL_DESCRIPTIONS, LEVEL_IDS } from '../domain/levels'
import {
  type PublicationBlockedReason,
  REVIEW_STATES,
  canPublishToLibrary,
} from '../domain/moderation'
import { priceInCredits } from '../domain/credits'
import { DISTRIBUTABLE_STATUSES, RIGHTS_STATUSES } from '../domain/rights'

/**
 * Anonymous visitors see only cleared, public, published books. A
 * signed-in reader also sees the books they uploaded, whatever state
 * those are in: a private workspace nobody can read is not a workspace
 * (CLAUDE.md section 6.2), and this rule is what a reader's own `/read`
 * and `/books` pages are refused by otherwise.
 *
 * This returned `true` for anyone signed in until 2026-08-17. That was
 * both too much and too little — it let any account read any other
 * reader's private upload, leaving only the artifact boundary in the
 * way, which is meant to be the second check and not the first.
 *
 * Annotated as `Where` because TypeScript otherwise widens the array
 * literal into a union that no longer satisfies Payload's query type.
 */
export const readBooks: Access = ({ req }) => {
  const publiclyVisible: Where = {
    and: [
      { visibility: { equals: 'public' } },
      { status: { equals: 'published' } },
      { rightsStatus: { in: [...DISTRIBUTABLE_STATUSES] } },
    ],
  }

  if (!req.user) return publiclyVisible
  if (req.user.roles?.includes('admin')) return true

  return { or: [publiclyVisible, { owner: { equals: req.user.id } }] }
}

/**
 * A reader-created book reaches the public library only through review.
 *
 * The rule itself lives in `domain/moderation.ts`; this hook only
 * supplies it with data and turns a refusal into an error. Business
 * logic must not accumulate in Payload hooks (CLAUDE.md section 2.1).
 *
 * Scoped to books that have an `owner`, which is what makes a book
 * reader-created. Library content entered by staff in the admin has no
 * owner and no submission to review — requiring one would mean an
 * editor could not publish a book without first submitting it to
 * themselves.
 */
const enforcePublicationReview: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const owner = data?.owner ?? originalDoc?.owner
  if (!owner) return data
  if ((data?.visibility ?? originalDoc?.visibility) !== 'public') return data

  const decision = canPublishToLibrary({
    reviewState: data?.review?.state ?? originalDoc?.review?.state ?? 'unsubmitted',
    rightsStatus: data?.rightsStatus ?? originalDoc?.rightsStatus ?? 'unknown',
  })

  if (!decision.allowed) {
    throw new APIError(
      `This book cannot be made public: ${PUBLICATION_ERRORS[decision.reason]}`,
      403,
    )
  }

  return data
}

/**
 * The price follows the page count; nobody sets it by hand.
 *
 * Derived on write rather than computed on read so that what a reader
 * was charged is a recorded fact rather than a re-derivation that could
 * change under them when the rule changes. The rule itself is in
 * `domain/credits.ts`.
 */
const priceFromPageCount: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const pages = data?.pageCount ?? originalDoc?.pageCount
  return { ...data, priceCredits: priceInCredits(pages) }
}

const PUBLICATION_ERRORS: Record<PublicationBlockedReason, string> = {
  not_submitted: 'it has not been submitted for review.',
  awaiting_review: 'its submission is still awaiting review.',
  rejected: 'its submission was rejected.',
  rights_not_cleared:
    'its rights status does not permit public distribution. Approval says a book belongs in the library; it does not clear the rights.',
}

/**
 * A Book is the whole work: one record, one DOCX master, one set of
 * generated formats.
 *
 * Books used to be split into Parts, each separately released and
 * separately downloadable. That is gone as of 2026-08-14 — a book is
 * kept whole, as it was written. What the split bought was staged
 * release, and what replaced it is the credit price below.
 *
 * The rights options are derived from the domain module rather than
 * restated here, so the vocabulary cannot drift between the CMS and the
 * code that enforces it.
 */
export const Books: CollectionConfig = {
  slug: 'books',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'rightsStatus', 'visibility', 'status'],
    group: 'Library',
  },
  access: {
    // Enforced again at the artifact boundary — this is defence in
    // depth, not the only check.
    read: readBooks,
  },
  hooks: {
    beforeChange: [enforcePublicationReview, priceFromPageCount],
  },
  fields: [
    { name: 'title', type: 'text', required: true, index: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'URL segment, e.g. "analects" for /books/analects.' },
    },
    { name: 'subtitle', type: 'text' },
    { name: 'originalTitle', type: 'text', admin: { description: 'Title in the original script, e.g. 道德經.' } },
    { name: 'author', type: 'text', index: true },
    { name: 'translator', type: 'text' },
    {
      name: 'language',
      type: 'select',
      defaultValue: 'zh-Hant',
      options: [
        { label: 'Traditional Chinese', value: 'zh-Hant' },
        { label: 'Simplified Chinese', value: 'zh-Hans' },
        { label: 'English', value: 'en' },
        { label: 'Mixed Chinese/English', value: 'zh-en' },
      ],
    },
    { name: 'description', type: 'textarea' },
    { name: 'cover', type: 'upload', relationTo: 'media' },
    {
      name: 'rightsStatus',
      type: 'select',
      required: true,
      // Fails closed: an unreviewed book is never distributable.
      defaultValue: 'unknown',
      index: true,
      options: RIGHTS_STATUSES.map((value) => ({ label: value, value })),
      admin: {
        description: 'Only public_domain, licensed and permission_granted may be distributed publicly.',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: [
        { label: 'Public library', value: 'public' },
        { label: 'Private workspace', value: 'private' },
      ],
      admin: { description: 'Private user conversions must never appear in the public catalog.' },
    },
    {
      name: 'level',
      type: 'number',
      required: true,
      defaultValue: LEVEL_IDS[DEFAULT_BOOK_LEVEL],
      index: true,
      admin: {
        description: `How deep into the library this book sits: ${BOOK_LEVELS.map(
          (level) => `${LEVEL_IDS[level]} = ${level} (${LEVEL_DESCRIPTIONS[level]})`,
        ).join('  ·  ')}  —  a reader browsing at one id sees every book with an id at or below it. Curation, not access control: a reader can change their own level freely.`,
      },
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Set for private, user-owned conversions.' },
    },
    {
      name: 'review',
      type: 'group',
      admin: {
        description:
          'Review of a reader-created book before it joins the public library. Approval says the book belongs here; it is not a finding that it is legally distributable — rightsStatus decides that, separately.',
      },
      fields: [
        {
          name: 'state',
          type: 'select',
          required: true,
          defaultValue: 'unsubmitted',
          index: true,
          options: REVIEW_STATES.map((value) => ({ label: value, value })),
        },
        {
          name: 'submittedAt',
          type: 'date',
          admin: { condition: (_, siblingData) => siblingData?.state !== 'unsubmitted' },
        },
        {
          name: 'reviewedBy',
          type: 'relationship',
          relationTo: 'users',
          admin: { condition: (_, siblingData) => ['approved', 'rejected'].includes(siblingData?.state) },
        },
        {
          name: 'note',
          type: 'textarea',
          admin: {
            description: 'Shown to the uploader. A rejection without a reason is not a review.',
            condition: (_, siblingData) => ['approved', 'rejected'].includes(siblingData?.state),
          },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'In production', value: 'in_production' },
        { label: 'Published', value: 'published' },
      ],
    },
    {
      name: 'pageCount',
      type: 'number',
      index: true,
      admin: {
        description:
          'Pages in the DOCX master — the measure the price is derived from. Set by the conversion pipeline, or by hand for books entered in the admin. Left empty, the book costs the minimum: a reader is not charged for our missing metadata.',
      },
    },
    {
      name: 'estimatedPages',
      type: 'number',
      admin: {
        readOnly: true,
        description:
          'What the monthly quota was charged for this book, read from the file at upload. A real page count needs the book rendered, which happens far too late to decide whether to start converting — see domain/uploadQuota.ts. Replaced by pageCount once conversion finishes.',
      },
    },
    {
      name: 'priceCredits',
      type: 'number',
      index: true,
      admin: {
        readOnly: true,
        description:
          'Derived from pageCount on every save and shown to readers as the book’s price. Never edit directly — set pageCount instead.',
      },
    },
    {
      name: 'artifacts',
      type: 'array',
      admin: {
        description:
          'Object-storage keys for the generated formats. Never public URLs: these are streamed through the application after an authorization decision.',
      },
      fields: [
        {
          name: 'format',
          type: 'select',
          required: true,
          options: [
            { label: 'DOCX (editable master)', value: 'docx' },
            { label: 'EPUB 3', value: 'epub' },
            { label: 'PDF — Standard', value: 'pdf_standard' },
            { label: 'PDF — Large', value: 'pdf_large' },
            { label: 'PDF — Extra Large', value: 'pdf_xl' },
          ],
        },
        { name: 'storageKey', type: 'text', required: true },
        { name: 'bytes', type: 'number' },
        { name: 'checksum', type: 'text' },
        {
          name: 'downloadable',
          type: 'checkbox',
          defaultValue: true,
          admin: { description: 'The DOCX master is normally NOT reader-downloadable.' },
        },
      ],
    },
    {
      name: 'conversion',
      type: 'group',
      admin: {
        description:
          'Progress of a reader upload through the production pipeline. Library books entered by staff stay at "none".',
      },
      fields: [
        {
          name: 'state',
          type: 'select',
          // Defaulted rather than required, so a book created without a
          // conversion group at all — every library book — is valid.
          defaultValue: 'none',
          index: true,
          options: [
            { label: 'Not a conversion', value: 'none' },
            { label: 'Uploaded, awaiting the uploader’s details', value: 'draft' },

            // Phase 1 — original to DOCX master.
            //
            // Split at the OCR boundary: this application runs OCR (an
            // HTTP call to Document AI, which a Worker is billed almost
            // nothing to wait on), the converter builds the master from
            // the text.
            { label: '1. Queued for mastering', value: 'queued' },
            { label: '1. Reading the pages (OCR)', value: 'ocr' },
            { label: '1. Text ready, awaiting the converter', value: 'ocr_ready' },
            { label: '1. Building the DOCX master', value: 'mastering' },

            // The hinge. Phase 1 is done and the master exists; phase 2
            // has not run, or needs running again.
            //
            // Re-enterable on purpose, and the reason the phases are
            // separate states rather than one 'converting': the master
            // is the source of truth and is always open to correction
            // (CLAUDE.md sections 5 and 6.2). Every edit to it returns
            // the book here, and the formats are rebuilt from it —
            // without re-running OCR, which was the expensive part.
            { label: '2. Master ready, formats to build', value: 'master_ready' },
            { label: '2. Generating formats', value: 'formatting' },

            { label: 'Ready', value: 'ready' },
            { label: 'Failed', value: 'failed' },
          ],
        },
        {
          name: 'sourceHash',
          type: 'text',
          index: true,
          admin: {
            readOnly: true,
            description:
              'SHA-256 of the uploaded original. A byte-identical file that has already been read by OCR is reused rather than sent to Google a second time.',
          },
        },
        {
          name: 'pendingFormats',
          type: 'json',
          admin: {
            readOnly: true,
            description:
              'Formats a reader has asked for that have not been built yet. Empty means the next phase 2 run builds the release set (EPUB) — or, if the book already has formats, rebuilds all of them after a master edit.',
          },
        },
        {
          name: 'sourceKey',
          type: 'text',
          admin: { readOnly: true, description: 'The uploaded original in object storage.' },
        },
        { name: 'sourceFilename', type: 'text', admin: { readOnly: true } },
        {
          name: 'startedAt',
          type: 'date',
          index: true,
          admin: {
            readOnly: true,
            description:
              'When this book entered conversion. What the monthly quota counts by — a draft that never converted has cost nothing and is not charged.',
          },
        },
        { name: 'jobId', type: 'text', admin: { readOnly: true } },
        {
          name: 'ocrOperation',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'The Document AI long-running operation. Batch OCR answers into a bucket minutes later, so this is what a later request polls — without it a restart loses a job we have already paid for.',
          },
        },
        {
          name: 'ocrOutputPrefix',
          type: 'text',
          admin: {
            readOnly: true,
            description: 'Where in the scratch bucket that operation writes its output.',
          },
        },
        {
          name: 'ocrKey',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'The OCR text in R2, which is what the converter reads. Empty for a DOCX or text upload, which needs no OCR — the converter reads the original instead.',
          },
        },
        {
          name: 'message',
          type: 'textarea',
          admin: { description: 'Shown to the uploader when a conversion fails.' },
        },
      ],
    },
    {
      name: 'collections',
      type: 'relationship',
      relationTo: 'book-collections',
      hasMany: true,
    },
  ],
}
