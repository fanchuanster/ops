import type { CollectionConfig } from 'payload'

/**
 * When each reader first opened each book.
 *
 * This was the clock staged release ran on. Staged release went with
 * Parts, and the row survives it for a different reason: it is what
 * "books I have read" on the account page is built from. `startedAt` is
 * still written once and never moved forward, so it means "first
 * opened" rather than "last opened".
 */
export const ReadingProgress: CollectionConfig = {
  slug: 'reading-progress',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'book', 'startedAt'],
    group: 'Administration',
  },
  access: {
    read: ({ req }) => {
      if (!req.user) return false
      if (req.user.roles?.includes('admin')) return true
      return { user: { equals: req.user.id } }
    },
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  // Ordered (book, user) rather than (user, book) on purpose: Payload
  // names a composite index after its fields with no table prefix, and
  // SQLite index names are global — so `user_book_idx` here would
  // collide with the entitlements index of the same shape.
  indexes: [{ fields: ['book', 'user'], unique: true }],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'startedAt', type: 'date', required: true },
  ],
}
