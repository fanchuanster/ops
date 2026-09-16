import type { CollectionConfig } from 'payload'

export const CreditLedger: CollectionConfig = {
  slug: 'credit-ledger',
  admin: {
    useAsTitle: 'reason',
    defaultColumns: ['user', 'delta', 'reason', 'book', 'createdAt'],
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
    delete: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  indexes: [
    { fields: ['user', 'createdAt'] },
  ],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'delta',
      type: 'number',
      required: true,
      admin: { description: 'Positive for a grant, negative for a spend.' },
    },
    {
      name: 'reason',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Signup grant', value: 'signup' },
        { label: 'Monthly grant — signed in', value: 'monthly_active' },
        { label: 'Monthly grant — away', value: 'monthly_inactive' },
        { label: 'Unlocked a book', value: 'unlock' },
        { label: 'Sent a book again', value: 'resend' },
        { label: 'Share of a reader sending your book', value: 'uploader_share' },
        { label: 'Manual adjustment', value: 'adjustment' },
      ],
    },
    {
      name: 'book',
      type: 'relationship',
      relationTo: 'books',
      admin: { description: 'Set for unlocks and resends.' },
    },
    {
      name: 'month',
      type: 'text',
      index: true,
      admin: {
        description:
          'YYYY-MM, for monthly grants. Together with `user` this is what stops a month being granted twice.',
      },
    },
    {
      name: 'balanceAfter',
      type: 'number',
      admin: { description: 'The reader’s balance once this row was applied. Audit only.' },
    },
  ],
}
