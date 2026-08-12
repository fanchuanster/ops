import type { CollectionConfig } from 'payload'

/**
 * When each reader first opened each part.
 *
 * Staged release runs on a per-reader clock rather than a publication
 * date, so this is the clock. `startedAt` is written once and never
 * moved forward — otherwise re-opening a part would restart the delay
 * on the next one, which would punish re-reading.
 */
export const ReadingProgress: CollectionConfig = {
  slug: 'reading-progress',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'book', 'partOrder', 'startedAt'],
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
  indexes: [{ fields: ['user', 'book'] }],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'partOrder', type: 'number', required: true },
    { name: 'startedAt', type: 'date', required: true },
  ],
}
