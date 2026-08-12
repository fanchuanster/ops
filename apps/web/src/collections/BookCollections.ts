import type { CollectionConfig } from 'payload'

/** Curatorial groupings: "Chinese Wisdom", "Authors / Nan Huaijin", etc. */
export const BookCollections: CollectionConfig = {
  slug: 'book-collections',
  admin: { useAsTitle: 'title', group: 'Library' },
  access: { read: () => true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'description', type: 'textarea' },
    { name: 'parent', type: 'relationship', relationTo: 'book-collections' },
  ],
}
