import type { CollectionConfig } from 'payload'

import { RIGHTS_STATUSES } from '../domain/rights'

/**
 * A Part is the readable/downloadable unit. Artifacts (EPUB/PDF/DOCX)
 * are references into object storage, not Payload uploads: they are
 * large, access-controlled, and served via short-lived signed URLs
 * rather than public media routes (sections 12, 13).
 */
export const Parts: CollectionConfig = {
  slug: 'parts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'book', 'order', 'status'],
    group: 'Library',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'book', type: 'relationship', relationTo: 'books', required: true, index: true },
    { name: 'order', type: 'number', required: true, defaultValue: 1, index: true },
    {
      name: 'rightsStatus',
      type: 'select',
      options: RIGHTS_STATUSES.map((value) => ({ label: value, value })),
      admin: {
        description:
          'Optional override. A Part may be MORE restricted than its Book, never less. Leave blank to inherit.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'In review', value: 'in_review' },
        { label: 'Published', value: 'published' },
      ],
    },
    {
      // The canonical structured Book Model (section 9/10). JSONB, so it
      // can be queried and versioned without DOCX ever becoming the
      // internal source of truth.
      name: 'structuredContent',
      type: 'json',
      admin: { description: 'Canonical structured content. Generated artifacts derive from this.' },
    },
    { name: 'structuredSchemaVersion', type: 'number', defaultValue: 1 },
    {
      name: 'artifacts',
      type: 'array',
      admin: { description: 'Object-storage keys for generated formats. Never public URLs.' },
      fields: [
        {
          name: 'format',
          type: 'select',
          required: true,
          options: [
            { label: 'DOCX (editable master)', value: 'docx' },
            { label: 'EPUB 3', value: 'epub' },
            { label: 'PDF — Standard', value: 'pdf_standard' },
            { label: 'PDF — Large', value: 'pdf_large' },
            { label: 'PDF — Extra Large', value: 'pdf_xl' },
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
  ],
}
