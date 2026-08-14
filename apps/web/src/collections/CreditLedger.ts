import type { CollectionConfig } from 'payload'

/**
 * Every credit a reader has ever gained or spent.
 *
 * The reader's `credits` field on Users is the balance the checks read;
 * this is the account of how it got there. Keeping both is a deliberate
 * duplication: summing a ledger on D1 for every delivery decision would
 * be a table scan per request, and a balance nobody can explain is
 * worse than one that is slightly denormalised. Anything that moves the
 * balance writes a row here in the same operation — see
 * `lib/credits.ts`, which is the only thing that may.
 *
 * Nothing here is writable through the API. A reader who could create
 * ledger rows could grant themselves the library.
 */
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
    // Always read as "this reader's history, newest first".
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
