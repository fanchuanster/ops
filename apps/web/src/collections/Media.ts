import type { CollectionConfig } from 'payload'

import { COVER_MIME_TYPES } from '../domain/cover'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: {
    read: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  upload: {
    mimeTypes: [...COVER_MIME_TYPES],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: { description: 'Describes the image for screen readers.' },
    },
  ],
}
