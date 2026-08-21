import type { CollectionConfig } from 'payload'

/** Curatorial groupings: "Chinese Wisdom", "Authors / Nan Huaijin", etc. */
export const BookCollections: CollectionConfig = {
  slug: 'book-collections',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'sortOrder', 'slug'], group: 'Library' },
  access: { read: () => true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'description', type: 'textarea' },
    { name: 'parent', type: 'relationship', relationTo: 'book-collections' },
    {
      name: 'sortOrder',
      type: 'number',
      admin: {
        description:
          'Where this shelf sits on the home page, lowest first. Left empty it falls to the end and sorts by title — which is what every collection did before anyone chose. Set from /admin/collections rather than typed here.',
      },
    },
  ],
}
