import type { CollectionConfig } from 'payload'

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
  indexes: [{ fields: ['book', 'user'], unique: true }],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'startedAt', type: 'date', required: true },
  ],
}
