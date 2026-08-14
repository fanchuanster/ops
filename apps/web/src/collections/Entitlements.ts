import type { CollectionConfig } from 'payload'

/**
 * Books a reader has bought.
 *
 * One row per (reader, book), created the first time they spend credits
 * to have it delivered. It is what makes the price a purchase rather
 * than a rental: the row is what later deliveries are charged the flat
 * resend rate against instead of the full price again.
 *
 * Never expires and is never deleted by anything automatic. A reader
 * who bought a book two years ago still owns it.
 */
export const Entitlements: CollectionConfig = {
  slug: 'entitlements',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'book', 'creditsPaid', 'createdAt'],
    group: 'Administration',
  },
  access: {
    read: ({ req }) => {
      if (!req.user) return false
      if (req.user.roles?.includes('admin')) return true
      return { user: { equals: req.user.id } }
    },
    // Written only by the delivery path, with access overridden. A
    // reader who could create one of these would own the library.
    create: () => false,
    update: () => false,
    delete: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  indexes: [
    // The delivery check is always "does this reader own this book".
    { fields: ['user', 'book'], unique: true },
  ],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    {
      name: 'creditsPaid',
      type: 'number',
      required: true,
      admin: { description: 'What it cost at the time, which the price rule may since have changed.' },
    },
  ],
}
