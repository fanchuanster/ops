import type { Access, CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'
import { APIError } from 'payload'

import { BOOK_LEVELS, DEFAULT_BOOK_LEVEL, LEVEL_DESCRIPTIONS, LEVEL_IDS } from '../domain/levels'
import {
  ADMIN_ONLY_BOOK_FIELDS,
  type PublicationBlockedReason,
  REVIEW_STATES,
  canPublishToLibrary,
} from '../domain/moderation'
import { priceInCredits } from '../domain/credits'
import { nextOrderId } from '../domain/shelfOrder'
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
 *
 * ## An administrator publishes directly
 *
 * `req.user` is what decides it, so this holds for every door into the
 * table — our own screens, the REST API, and a script written next
 * year. A
 * write that carries no user is not an administrator's, which is the
 * safe direction: it falls back to requiring the approved review.
 *
 * Publishing then **records the approval it implies**. Without that the
 * book would sit public with a `submitted` review — still in the
 * reviewer's queue, and, worse, refused by this very hook the next time
 * its owner saved anything, because that save is not an administrator's
 * and would find an unapproved public book. The invariant worth keeping
 * is simple: a public owned book has an approved review. This is what
 * keeps it true.
 */
const enforcePublicationReview: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const owner = data?.owner ?? originalDoc?.owner
  if (!owner) return data
  if ((data?.visibility ?? originalDoc?.visibility) !== 'public') return data

  const actor = req?.user
  const byAdmin = Boolean(actor?.roles?.includes('admin'))
  const ownerId = typeof owner === 'object' && owner ? owner.id : owner
  const reviewState = data?.review?.state ?? originalDoc?.review?.state ?? 'unsubmitted'

  const decision = canPublishToLibrary({
    reviewState,
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

  if (byAdmin && reviewState !== 'approved') {
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

/**
 * The price follows the page count; nobody sets it by hand.
 *
 * Derived on write rather than computed on read so that what a reader
 * was charged is a recorded fact rather than a re-derivation that could
 * change under them when the rule changes. The rule itself is in
 * `domain/credits.ts`.
 *
 * **The estimate is the fallback, and since 2026-08-26 it is usually the
 * answer.** `pageCount` used to be filled in by the converter, which got
 * it by laying the whole book out in WeasyPrint and counting the pages
 * that came out. Nothing renders a PDF from a master any more, so
 * nothing counts pages that way, and a page is a rendering artifact
 * rather than a property of a book.
 *
 * `estimatedPages` is what remains, and it is not a poor substitute: for
 * a PDF upload it is the page tree's own count — the *original's* pages,
 * which is a truer answer than counting our typesetting ever was — and
 * for a DOCX or text file it is characters over a printed-page constant
 * (`domain/uploadQuota.ts`). Without this fallback, dropping the
 * renderer would have quietly priced every converted book at the
 * one-credit minimum.
 */
const priceFromPageCount: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const pages =
    data?.pageCount ??
    originalDoc?.pageCount ??
    data?.estimatedPages ??
    originalDoc?.estimatedPages
  return { ...data, priceCredits: priceInCredits(pages) }
}

/** The shelf a stored relationship names, whatever shape it came back in. */
function shelfIdOf(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') {
    return (value as { id: number }).id
  }
  return null
}

/**
 * A book's place among the books on its shelf.
 *
 * A hook and not something the upload flow does, because there is more
 * than one way a book arrives on a shelf — the portal, the editorial
 * panel, the seed script, the REST API — and a book with no number at
 * all would sort ahead of every placed one (`domain/shelfOrder.ts`
 * explains why null cannot mean "unplaced" here).
 *
 * Three cases:
 *
 *   - No shelf: no order id. An order id is a position among a
 *     collection's own books, so a book on no shelf has none rather
 *     than a stale number from the shelf it left.
 *   - A stated number is obeyed exactly, and nothing else moves.
 *     Duplicates are allowed since 2026-08-25 — two books at 3 read
 *     alphabetically between themselves — so there is no collision left
 *     for anyone to resolve.
 *
 *     "Stated" means *different from what is stored*, and that is not
 *     pedantry. Payload hands a `beforeChange` hook the whole document
 *     with the update merged into it, so `data.collectionOrder` is
 *     always a number on an update — the book's current one when
 *     nobody touched it. Reading its mere presence as an instruction
 *     made every move to another shelf keep the number it had on the
 *     shelf it left, which is exactly the bug this rule exists to
 *     prevent.
 *   - Otherwise a book that has just landed on this shelf goes to the
 *     end of it, one past the highest already there. A book already on
 *     it keeps the number it has.
 *
 * Every filed book therefore carries a number, whether or not anyone
 * looks at it: whether a reader ever sees that order is the shelf's
 * `childOrder` (`domain/shelfOrder.ts`), which is A–Z by default.
 */
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
        // Itself excluded: a book being re-saved on the shelf it is
        // already on must not be pushed past its own number.
        .filter((book) => book.id !== originalDoc?.id)
        .map((book) => ({ id: book.id, title: book.title, order: book.collectionOrder })),
    ),
  }
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
/**
 * Write access for the fields in `ADMIN_ONLY_BOOK_FIELDS`.
 *
 * Those fields were documented as an administrator's since the portal
 * was built (CLAUDE.md section 6.1) and were enforced only by which
 * screen offered them — the editorial UI has no control for rights,
 * visibility or a book's position on its shelf, so nobody could set
 * them by accident. That is not the same as nobody being able to set
 * them: Payload's REST and GraphQL APIs are another door, `overrideAccess`
 * is off there, and an unspecified access rule defaults to "any logged-in
 * user". A signed-in reader could PATCH `collectionOrder` and walk their
 * own book to the front of a shelf.
 *
 * Payload strips a field a caller may not write rather than failing the
 * request, which is the right shape here: the rest of an otherwise
 * legitimate update still applies.
 *
 * Every server action and route in the application writes with
 * `overrideAccess: true`, which skips field access entirely, so this
 * changes nothing about the admin screens or the upload flow — it only
 * closes the door those screens were never the lock on.
 */
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
    defaultColumns: ['title', 'author', 'rightsStatus', 'visibility', 'status'],
    group: 'Library',
  },
  access: {
    // Enforced again at the artifact boundary — this is defence in
    // depth, not the only check.
    read: readBooks,
  },
  hooks: {
    beforeChange: [enforcePublicationReview, priceFromPageCount, assignCollectionOrder],
  },
  fields: [
    {
      /**
       * One book, one title.
       *
       * Unique since 2026-08-24, after the same scan was uploaded twice
       * and sat in the library as two books. Nothing else would have
       * caught it: each upload mints its own job id and the slug carries
       * eight characters of it precisely so two uploads *cannot*
       * collide, and the one content-hash check we have
       * (`conversion.sourceHash`, `lib/masterPipeline.ts`) only runs in
       * the Adobe export path — neither copy went through it.
       *
       * The cost is real and worth stating: two genuinely different
       * books can share a title. A second translation of 道德經, or two
       * volumes a publisher named identically, are now refused rather
       * than filed. The answer when that happens is to say which one it
       * is in the title itself — the catalog shows the title and nothing
       * beside it, so two rows reading `道德經` were never going to be
       * tellable apart by a reader either.
       *
       * Trimmed before it is compared, so trailing whitespace cannot
       * walk a duplicate past the constraint.
       */
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
    { name: 'originalTitle', type: 'text', admin: { description: 'Title in the original script, e.g. 道德經.' } },
    { name: 'author', type: 'text', index: true },
    {
      name: 'language',
      type: 'select',
      // Simplified first, and the default, since 2026-08-24: it is what
      // most uploads actually are, and this value is what an uploader
      // gets when the file said nothing about itself
      // (`actions/upload.ts` only overrides it when extraction found a
      // language). Traditional remains the fallback for a file that
      // says bare `zh` — that is a signal rather than a silence, and
      // `normalizeLanguage` in `domain/metadata.ts` decides it.
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
            // Terminal. A cover is cosmetic, so a source the renderer
            // cannot open is not re-offered to every poll forever;
            // clearing this by hand is how a fixed renderer retries.
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
      access: adminOnlyField,
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
      /**
       * Who uploaded a book is nobody else's business.
       *
       * The field is readable by its own owner and by an administrator,
       * and by nobody else — not in the UI, not in a populated
       * relationship, and not through `/api/books` or GraphQL. Payload
       * deletes the field from the response when this returns false.
       *
       * The uploader's *identity* was already protected: the Users
       * collection only lets you read yourself, so a populated `owner`
       * came back as a bare id to a stranger. What that still leaked is
       * the correlation — that these eleven books were all uploaded by
       * the same person, and which one of them is yours — and a reader
       * who wanted to publish anonymously had no way to know it.
       *
       * Field access is skipped entirely under `overrideAccess: true`,
       * which is how every ownership check in the application still
       * works: `authorizeDownload`, the account pages, the quota and
       * the admin all read the book with access overridden. The one
       * path that does not is the public book page, and there a
       * stranger seeing no owner is the correct answer — they are not
       * the owner.
       *
       * It also stops `?where[owner][equals]=7` being a usable query
       * for anyone but its subject, because Payload validates query
       * paths against this same rule.
       */
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
          // The uploader's suggestion, and nothing more. It lives in
          // the review group rather than beside `level` because that is
          // what it is: part of what was said when the book was
          // submitted, not a property of the book. Nothing in the
          // catalog reads it, and approving a submission does not copy
          // it across — `level` above is still set by hand, by whoever
          // is deciding.
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
          // Defaulted rather than required, so a book created without a
          // conversion group at all — every library book — is valid.
          defaultValue: 'none',
          index: true,
          options: [
            { label: 'Not a conversion', value: 'none' },
            { label: 'Uploaded, awaiting the uploader’s details', value: 'draft' },

            // Phase 1 — original to DOCX master.
            //
            // A PDF is read and mastered by Adobe's Export PDF, which
            // is an HTTP call a Worker is billed almost nothing to wait
            // on, and lands on 'master_ready' directly. A DOCX or text
            // upload needs no export and goes to 'ocr_ready', where the
            // converter builds the master itself.
            { label: '1. Queued for mastering', value: 'queued' },
            { label: '1. Reading the pages (OCR)', value: 'ocr' },
            { label: '1. Source ready, awaiting the converter', value: 'ocr_ready' },
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
              'Whether the uploader asked for AI-assisted correction, which sends their text to a third-party model (CLAUDE.md sections 4 and 6.1). Theirs to decide, on the details form; false unless they said otherwise, so a book nobody answered for is never sent.',
          },
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
              'What was uploaded. Decides which formats phase 2 can build at all — a PDF source already has its PDF, so only the EPUB is generated.',
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
          name: 'message',
          type: 'textarea',
          admin: { description: 'Shown to the uploader when a conversion fails.' },
        },
      ],
    },
    {
      /**
       * The one shelf this book sits on.
       *
       * `hasMany` until 2026-08-24, and the plural was doing real harm.
       * A book on two shelves appeared twice in the library — once
       * under each — and a reader cannot tell a book that is genuinely
       * in two places from the same book printed twice. Worse, every
       * count of a shelf had to be a Set of ids rather than a length,
       * in the catalog, the admin tree and the reader-facing tally,
       * because a parent and its child could both hold the same book.
       *
       * Nesting is what the plural was really for. A book belongs on
       * "Confucian", and a reader opening "Chinese Classics" finds it
       * because that shelf carries everything beneath it
       * (`domain/collectionTree.ts`) — not because the book was filed
       * on both. One shelf, and the tree does the rest.
       *
       * The foreign key clears rather than refuses, like `parent` on
       * the collection itself: deleting a shelf must never take its
       * books with it. A book with no shelf is a real state — the
       * Library screen gives it a group of its own.
       */
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
      /**
       * Where this book sits among the books on its own shelf.
       *
       * Given when the book is filed — one past the highest already
       * there — and unique among that shelf's books, which is what lets
       * a reader browse the library in the order somebody put it in
       * rather than in alphabetical order nobody chose. Typing a number
       * another book holds shifts that book and the run behind it along
       * (`placeInOrder` in `domain/shelfOrder.ts`); the numbers are
       * therefore stable and need not be contiguous.
       *
       * Null for a book on no shelf: the number is a position among a
       * collection's own books, so off the shelf there is nothing for
       * it to be a position in.
       *
       * Indexed because the catalog sorts on it — that sort is on every
       * browse of the library, filtered down to one subtree or not.
       */
      name: 'collectionOrder',
      access: adminOnlyField,
      type: 'number',
      index: true,
      admin: {
        description:
          'Where this book sits on its shelf, lowest first. Set from /admin/library rather than typed here; a number another book already has shifts that book down.',
      },
    },
  ],
}
