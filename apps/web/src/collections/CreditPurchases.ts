import type { CollectionConfig } from 'payload'

export const CreditPurchases: CollectionConfig = {
  slug: 'credit-purchases',
  admin: {
    useAsTitle: 'orderId',
    defaultColumns: ['user', 'credits', 'payCurrency', 'status', 'createdAt'],
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
  indexes: [{ fields: ['user', 'createdAt'] }],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'orderId', type: 'text', required: true, unique: true, index: true },
    { name: 'credits', type: 'number', required: true },
    { name: 'priceUsd', type: 'number', required: true },
    { name: 'payCurrency', type: 'text', required: true },
    { name: 'providerPaymentId', type: 'text', index: true },
    { name: 'payAddress', type: 'text' },
    { name: 'payAmount', type: 'text' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Waiting for payment', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Failed or refunded', value: 'failed' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    { name: 'expiresAt', type: 'date' },
    {
      name: 'creditedAt',
      type: 'date',
      admin: { description: 'Set in the same step that moves the status to paid.' },
    },
  ],
}
