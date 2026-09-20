import type { Access, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import { BOOK_LEVELS, DEFAULT_BOOK_LEVEL, LEVEL_DESCRIPTIONS, LEVEL_IDS } from '../domain/levels'
import {
  type PublicationBlockedReason,
  REVIEW_STATES,
  canPublishToLibrary,
} from '../domain/moderation'
import { priceInCredits } from '../domain/credits'
import { renamedSlug } from '../domain/slug'
import { freeBookSlug } from '../lib/bookSlug'
import { nextOrderId } from '../domain/shelfOrder'
import { DISTRIBUTABLE_STATUSES, RIGHTS_STATUSES } from '../domain/rights'

export const readBooks: Access = ({ req }) => {
  const publiclyVisible: Where = {
    and: [
      { status: { equals: 'published' } },
      { rightsStatus: { in: [...DISTRIBUTABLE_STATUSES] } },
      { or: [{ owner: { exists: false } }, { 'review.state': { equals: 'approved' } }] },
    ],
  }

  if (!req.user) return publiclyVisible
  if (req.user.roles?.includes('admin')) return true

  return { or: [publiclyVisible, { owner: { equals: req.user.id } }] }
}

const enforcePublicationReview: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const owner = data?.owner ?? originalDoc?.owner
  if (!owner) return data
  const priorState = originalDoc?.review?.state ?? 'unsubmitted'
  const nextState = data?.review?.state ?? priorState
  if (nextState !== 'approved' || priorState === 'approved') return data

  const actor = req?.user
  const byAdmin = Boolean(actor?.roles?.includes('admin'))
  const ownerId = typeof owner === 'object' && owner ? owner.id : owner

  const decision = canPublishToLibrary({
    reviewState: priorState,
    rightsStatus: data?.rightsStatus ?? originalDoc?.rightsStatus ?? 'unknown',
    byAdmin,
    ownedByRequester: Boolean(actor && String(ownerId) === String(actor.id)),
  })

  if (!decision.allowed) {
    throw new APIError(
      `This book cannot be made public: ${PUBLICATION_ERRORS[decision.reason]}`,
      403,
    )
  }

  if (byAdmin) {
    return {
      ...data,
      review: {
        ...(originalDoc?.review ?? {}),
        ...(data?.review ?? {}),
        state: 'approved',
        reviewedBy: actor!.id,
      },
    }
  }

  return data
}

const priceFromPageCount: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const pages =
    data?.pageCount ??
    originalDoc?.pageCount ??
    data?.estimatedPages ??
    originalDoc?.estimatedPages
  return { ...data, priceCredits: priceInCredits(pages) }
}

function shelfIdOf(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') {
    return (value as { id: number }).id
  }
  return null
}

const assignCollectionOrder: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const was = shelfIdOf(originalDoc?.collection)
  const shelf = 'collection' in data ? shelfIdOf(data.collection) : was
  if (shelf === null) return { ...data, collectionOrder: null }

  const stated =
    typeof data.collectionOrder === 'number' &&
    data.collectionOrder !== originalDoc?.collectionOrder
  if (stated) return data

  const moved = operation === 'create' || shelf !== was
  if (!moved && typeof originalDoc?.collectionOrder === 'number') return data

  const siblings = await req.payload.find({
    collection: 'books',
    where: { collection: { equals: shelf } },
    limit: 1000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  return {
    ...data,
    collectionOrder: nextOrderId(
      siblings.docs
        .filter((book) => book.id !== originalDoc?.id)
        .map((book) => ({ id: book.id, title: book.title, order: book.collectionOrder })),
    ),
  }
}

const slugFollowsTitle: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || !data || !originalDoc) return data

  const title = typeof data.title === 'string' ? data.title : null
  if (!title || title === originalDoc.title) return data
  if (typeof data.slug === 'string' && data.slug !== originalDoc.slug) return data

  const renamed = renamedSlug(originalDoc.slug ?? '', originalDoc.title ?? '', title)
  if (!renamed) return data

  return { ...data, slug: await freeBookSlug(req.payload, renamed, originalDoc.id) }
}

const PUBLICATION_ERRORS: Record<PublicationBlockedReason, string> = {
  not_submitted: 'it has not been submitted for review.',
  awaiting_review: 'its submission is still awaiting review.',
  rejected: 'its submission was rejected.',
  not_offered:
    'its uploader has not offered it to the library. An administrator can approve a submission early, but not make one on someone else’s behalf.',
  rights_not_cleared:
    'its rights status does not permit public distribution. Approval says a book belongs in the library; it does not clear the rights.',
}

const adminOnlyField = {
  create: ({ req }: { req: { user?: { roles?: string[] | null } | null } }) =>
    Boolean(req.user?.roles?.includes('admin')),
  update: ({ req }: { req: { user?: { roles?: string[] | null } | null } }) =>
    Boolean(req.user?.roles?.includes('admin')),
}

export const Books: CollectionConfig = {
  slug: 'books',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'rightsStatus', 'status'],
    group: 'Library',
  },
  access: {
    read: readBooks,
  },
  hooks: {
    beforeChange: [
      enforcePublicationReview,
      priceFromPageCount,
      assignCollectionOrder,
      slugFollowsTitle,
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim() : value)],
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'URL segment, e.g. "analects" for /books/analects.' },
    },
    { name: 'subtitle', type: 'text' },
    { name: 'author', type: 'text', index: true },
    {
      name: 'language',
      type: 'select',
      defaultValue: 'zh-Hans',
      options: [
        { label: 'Simplified Chinese', value: 'zh-Hans' },
        { label: 'Traditional Chinese', value: 'zh-Hant' },
        { label: 'English', value: 'en' },
        { label: 'Mixed Chinese/English', value: 'zh-en' },
      ],
    },
    { name: 'description', type: 'textarea' },
    { name: 'cover', type: 'upload', relationTo: 'media' },
    {
      name: 'generatedCover',
      type: 'group',
      admin: {
        description:
          'Page one of the book, rendered by the converter and used when no cover has been uploaded. The upload above always wins; this is only ever the default. See domain/cover.ts.',
      },
      fields: [
        {
          name: 'state',
          type: 'select',
          defaultValue: 'pending',
          index: true,
          options: [
            { label: 'Waiting for a converter', value: 'pending' },
            { label: 'Rendering', value: 'rendering' },
            { label: 'Ready', value: 'ready' },
            { label: 'Could not be rendered', value: 'failed' },
          ],
        },
        {
          name: 'key',
          type: 'text',
          admin: { readOnly: true, description: 'The rendered cover in object storage.' },
        },
        {
          name: 'candidates',
          type: 'number',
          defaultValue: 1,
          admin: {
            readOnly: true,
            description:
              'How many opening pages the converter rendered to choose between. One for an EPUB, which has a single declared cover image, and for every book rendered before candidates existed.',
          },
        },
        {
          name: 'page',
          type: 'number',
          defaultValue: 1,
          admin: {
            description:
              'Which of those pages the book wears. One unless its owner or an editor picked another (domain/cover.ts).',
          },
        },
      ],
    },
    {
      name: 'rightsStatus',
      access: adminOnlyField,
      type: 'select',
      required: true,
      defaultValue: 'unknown',
      index: true,
      options: RIGHTS_STATUSES.map((value) => ({ label: value, value })),
      admin: {
        description: 'Only public_domain, licensed and permission_granted may be distributed publicly.',
      },
    },
    {
      name: 'level',
      access: adminOnlyField,
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
      access: {
        read: ({ req, doc, data }) => {
          if (!req.user) return false
          if (req.user.roles?.includes('admin')) return true

          const record = (doc ?? data) as { owner?: unknown } | undefined
          const owner = record?.owner
          const ownerId = typeof owner === 'object' && owner ? (owner as { id?: unknown }).id : owner
          return ownerId !== undefined && ownerId !== null && String(ownerId) === String(req.user.id)
        },
      },
      admin: { description: 'Set for private, user-owned conversions.' },
    },
    {
      name: 'review',
      access: adminOnlyField,
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
          name: 'proposedLevel',
          type: 'number',
          admin: {
            readOnly: true,
            description: `The uploader’s suggestion: ${BOOK_LEVELS.map(
              (level) => `${LEVEL_IDS[level]} = ${level}`,
            ).join('  ·  ')}. Never applied automatically — set “level” above yourself, whether or not you agree.`,
            condition: (_, siblingData) => Boolean(siblingData?.proposedLevel),
          },
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
            { label: 'DOCX (editable master, owner only)', value: 'docx' },
            { label: 'EPUB 3', value: 'epub' },
            { label: 'PDF (the original’s layout)', value: 'pdf' },
            { label: 'Plain text (the upload itself)', value: 'txt' },
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
          defaultValue: 'none',
          index: true,
          options: [
            { label: 'Not a conversion', value: 'none' },
            { label: 'Uploaded, awaiting the uploader’s details', value: 'draft' },

            { label: '1. Queued for mastering', value: 'queued' },
            { label: '1. Reading the pages (OCR)', value: 'ocr' },
            { label: '1. Source ready, awaiting the converter', value: 'ocr_ready' },
            { label: '1. Building the DOCX master', value: 'mastering' },

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
              'SHA-256 of the uploaded original. A byte-identical file that has already been converted has its DOCX master copied rather than being sent to Adobe a second time.',
          },
        },
        {
          name: 'plan',
          type: 'select',
          defaultValue: 'convert',
          options: [
            { label: 'Convert to an e-reader edition', value: 'convert' },
            { label: 'Publish the original as it stands', value: 'as_is' },
          ],
          admin: {
            readOnly: true,
            description:
              'What the uploader chose. A PDF and a plain text file get the choice; a DOCX is already a master and an EPUB is already an edition, so neither has anything to decide. Set on the details form; see domain/publication.ts.',
          },
        },
        {
          name: 'aiCorrection',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            readOnly: true,
            description:
              'Whether the uploader asked for AI-assisted correction, which sends their text to a third-party model (docs/PIPELINE.md section 4, docs/RIGHTS.md section 6.1). Theirs to decide, on the details form; false unless they said otherwise, so a book nobody answered for is never sent.',
          },
        },
        {
          name: 'correction',
          type: 'group',
          admin: {
            description:
              'AI-assisted correction: proposed, decided by the owner, then applied to the master.',
          },
          fields: [
            {
              name: 'state',
              type: 'select',
              defaultValue: 'none',
              index: true,
              options: [
                { label: 'Not asked for', value: 'none' },
                { label: 'Master ready, suggestions to propose', value: 'pending' },
                { label: 'Proposing corrections', value: 'running' },
                { label: 'Suggestions awaiting the owner', value: 'ready' },
                { label: 'Decided, awaiting the converter', value: 'decided' },
                { label: 'Rewriting the master', value: 'applying' },
                { label: 'Applied to the master', value: 'applied' },
                { label: 'Failed', value: 'failed' },
              ],
              admin: { readOnly: true },
            },
            {
              name: 'suggestionsKey',
              type: 'text',
              admin: {
                readOnly: true,
                description:
                  'Where the converter wrote the proposals. Not an artifact: it is never served to a reader and never delivered to a device.',
              },
            },
            {
              name: 'decisionsKey',
              type: 'text',
              admin: {
                readOnly: true,
                description: 'What the owner adopted and declined, as the converter reads it.',
              },
            },
            {
              name: 'count',
              type: 'number',
              admin: {
                readOnly: true,
                description: 'How many suggestions are waiting, so the book page can say so without fetching the file.',
              },
            },
            {
              name: 'adopted',
              type: 'number',
              admin: {
                readOnly: true,
                description: 'How many the owner adopted on the last pass.',
              },
            },
            {
              name: 'message',
              type: 'text',
              admin: { readOnly: true },
            },
          ],
        },
        {
          name: 'sources',
          type: 'array',
          admin: {
            readOnly: true,
            description:
              'The uploaded originals, one per format. The master is built from whichever the owner has chosen; see domain/sources.ts.',
          },
          fields: [
            {
              name: 'kind',
              type: 'select',
              required: true,
              options: [
                { label: 'PDF', value: 'pdf' },
                { label: 'DOCX', value: 'docx' },
                { label: 'EPUB', value: 'epub' },
                { label: 'Plain text', value: 'text' },
              ],
            },
            {
              name: 'storageKey',
              type: 'text',
              required: true,
              admin: {
                description:
                  'Under the book, never the conversion/ key it was uploaded to — that prefix is swept after 30 days.',
              },
            },
            {
              name: 'filename',
              type: 'text',
              admin: { description: 'The uploader\u2019s own name for it, which is what they recognise it by.' },
            },
            { name: 'bytes', type: 'number' },
            { name: 'addedAt', type: 'date' },
          ],
        },
        {
          name: 'sourceKind',
          type: 'select',
          options: [
            { label: 'PDF', value: 'pdf' },
            { label: 'DOCX', value: 'docx' },
            { label: 'EPUB', value: 'epub' },
            { label: 'Plain text', value: 'text' },
          ],
          admin: {
            readOnly: true,
            description:
              'Which of the sources above the master is built from. Decides which formats phase 2 can build at all \u2014 a PDF source already has its PDF, so only the EPUB is generated.',
          },
        },
        {
          name: 'sourceKey',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'The chosen source in object storage. Points at the conversion/ key while the book is a draft and at the book\u2019s own key once it is filed \u2014 the two hold the same bytes, but only the second outlives the 30-day sweep.',
          },
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
          name: 'exportJob',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'The Adobe Export PDF job. It answers minutes later, so this is what a later request polls \u2014 without it a restart loses a job we have already paid for.',
          },
        },
        {
          name: 'exportAsset',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'The uploaded file on Adobe\u2019s side, deleted once its master is safely in R2.',
          },
        },
        {
          name: 'exportStartedAt',
          type: 'date',
          admin: {
            readOnly: true,
            description:
              'When the export was submitted. Adobe expires assets after a day, so a job still running long past this can never be collected and the book is failed instead of polled forever.',
          },
        },
        {
          name: 'exportRetries',
          type: 'number',
          defaultValue: 0,
          admin: {
            readOnly: true,
            description:
              'How many times the pipeline has re-submitted this export after a transient Adobe failure. Bounded by MAX_EXPORT_RETRIES, and reset to 0 whenever a person re-queues the book by hand.',
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
      name: 'collection',
      type: 'relationship',
      relationTo: 'book-collections',
      index: true,
      admin: {
        description:
          'The shelf this book sits on. One only — a reader finds it under every parent of that shelf, so filing it twice prints it twice.',
      },
    },
    {
      name: 'collectionOrder',
      access: adminOnlyField,
      type: 'number',
      index: true,
      admin: {
        description:
          'Where this book sits on its shelf, lowest first, on a shelf whose childOrder is sequence. Set from /admin/library or the book’s own page rather than typed here. Numbers need not be unique or contiguous: two books sharing one read alphabetically between themselves, and nothing else moves.',
      },
    },
  ],
}
