import type { CollectionConfig } from 'payload'

/**
 * The download ledger.
 *
 * One row per authorized download. This is what `checkDownloadLimit`
 * reads: it counts *distinct books* in a rolling window, so recording
 * every file is correct and cheap — five formats of one book are five
 * rows but one slot.
 *
 * Readers can see their own history and nobody else's. Nothing here is
 * writable through the API: rows are created only by the download route
 * after it has authorized the request, so a client cannot forge or
 * erase its own history to escape the limit.
 */
export const Downloads: CollectionConfig = {
  slug: 'downloads',
  admin: {
    useAsTitle: 'format',
    defaultColumns: ['user', 'book', 'part', 'format', 'createdAt'],
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
    // The limit check is always "this user, recently", so the ledger is
    // queried on both together.
    { fields: ['user', 'createdAt'] },
  ],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'part', type: 'relationship', relationTo: 'parts', required: true },
    { name: 'format', type: 'text', required: true },
  ],
}
