import type { Access, CollectionConfig, Where } from 'payload'

import { RIGHTS_STATUSES } from '../domain/rights'

/**
 * Anonymous visitors see only cleared, public, published books.
 * Annotated as `Where` because TypeScript otherwise widens the array
 * literal into a union that no longer satisfies Payload's query type.
 */
const readBooks: Access = ({ req }) => {
  if (req.user) return true

  const publiclyVisible: Where = {
    and: [
      { visibility: { equals: 'public' } },
      { status: { equals: 'published' } },
      { rightsStatus: { in: ['public_domain', 'licensed', 'permission_granted'] } },
    ],
  }

  return publiclyVisible
}

/**
 * A Book is the bibliographic record. Its readable content lives in
 * Parts; its rights status gates everything beneath it.
 *
 * The rights options are derived from the domain module rather than
 * restated here, so the vocabulary cannot drift between the CMS and the
 * code that enforces it.
 */
export const Books: CollectionConfig = {
  slug: 'books',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'rightsStatus', 'visibility', 'status'],
    group: 'Library',
  },
  access: {
    // Enforced again at the artifact boundary — this is defence in
    // depth, not the only check.
    read: readBooks,
  },
  fields: [
    { name: 'title', type: 'text', required: true, index: true },
    { name: 'subtitle', type: 'text' },
    { name: 'originalTitle', type: 'text', admin: { description: 'Title in the original script, e.g. 道德經.' } },
    { name: 'author', type: 'text', index: true },
    { name: 'translator', type: 'text' },
    {
      name: 'language',
      type: 'select',
      defaultValue: 'zh-Hant',
      options: [
        { label: 'Traditional Chinese', value: 'zh-Hant' },
        { label: 'Simplified Chinese', value: 'zh-Hans' },
        { label: 'English', value: 'en' },
        { label: 'Mixed Chinese/English', value: 'zh-en' },
      ],
    },
    { name: 'description', type: 'textarea' },
    { name: 'cover', type: 'upload', relationTo: 'media' },
    {
      name: 'rightsStatus',
      type: 'select',
      required: true,
      // Fails closed: an unreviewed book is never distributable.
      defaultValue: 'unknown',
      index: true,
      options: RIGHTS_STATUSES.map((value) => ({ label: value, value })),
      admin: {
        description: 'Only public_domain, licensed and permission_granted may be distributed publicly.',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: [
        { label: 'Public library', value: 'public' },
        { label: 'Private workspace', value: 'private' },
      ],
      admin: { description: 'Private user conversions must never appear in the public catalog.' },
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Set for private, user-owned conversions.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'In production', value: 'in_production' },
        { label: 'Published', value: 'published' },
      ],
    },
    {
      name: 'stagedRelease',
      type: 'group',
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false },
        {
          name: 'unlockDelayHours',
          type: 'number',
          defaultValue: 24,
          admin: {
            condition: (_, siblingData) => Boolean(siblingData?.enabled),
            description: 'Per-reader delay before the next part opens.',
          },
        },
      ],
    },
    {
      name: 'collections',
      type: 'relationship',
      relationTo: 'book-collections',
      hasMany: true,
    },
  ],
}
