import type { CollectionConfig } from 'payload'

/**
 * The delivery ledger: one row per book actually sent to a device.
 *
 * It used to feed the rolling 24-hour limit, which is gone — credits
 * are the gate now (domain/credits.ts). What it feeds instead is the
 * reader's own history, and the audit question "was this book really
 * delivered, and when".
 *
 * Readers can see their own rows and nobody else's. Nothing here is
 * writable through the API: rows are created only after the delivery
 * path has authorized and charged for the send.
 */
export const Downloads: CollectionConfig = {
  slug: 'downloads',
  admin: {
    useAsTitle: 'format',
    defaultColumns: ['user', 'book', 'format', 'creditsPaid', 'createdAt'],
    group: 'Administration',
  },
  access: {
    read: ({ req }) => {
      if (!req.user) return false
      if (req.user.roles?.includes('admin')) return true
      return { user: { equals: req.user.id } }
    },
    // Server-side only. `overrideAccess` in the download route is what
    // writes these; there is no legitimate client-side create.
    create: () => false,
    update: () => false,
    delete: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  indexes: [
    // Always read as "this reader's history, newest first".
    { fields: ['user', 'createdAt'] },
  ],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'format', type: 'text', required: true },
    {
      name: 'creditsPaid',
      type: 'number',
      admin: { description: 'What this particular send cost — the book price, or the resend rate.' },
    },
  ],
}
