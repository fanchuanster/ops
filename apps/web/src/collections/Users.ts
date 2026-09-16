import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { KINDLE_DOMAINS, KINDLE_SENDER_ADDRESS, checkKindleAddress } from '../domain/kindle'
import { SIGNUP_GRANT } from '../domain/credits'
import { checkPassword } from '../domain/password'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    useAPIKey: true,
    tokenExpiration: 60 * 60 * 24 * 365,
  },
  admin: {
    useAsTitle: 'email',
    group: 'Administration',
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (operation === 'create' || typeof data?.password === 'string') {
          const problem = checkPassword(data?.password)
          if (problem) throw new APIError(problem.message, 400)
        }
        return data
      },
    ],
  },
  access: {
    create: () => true,
    read: ({ req }) => {
      if (!req.user) return false
      if (req.user.roles?.includes('admin')) return true
      return { id: { equals: req.user.id } }
    },
    update: ({ req }) => {
      if (!req.user) return false
      if (req.user.roles?.includes('admin')) return true
      return { id: { equals: req.user.id } }
    },
    delete: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  fields: [
    {
      name: 'displayName',
      type: 'text',
    },
    {
      name: 'kindleEmail',
      type: 'text',
      label: 'Kindle delivery address',
      admin: {
        description:
          'The reader’s @kindle.com address. Delivery is off until this is set. ' +
          `They must also add ${KINDLE_SENDER_ADDRESS} to their Approved Personal ` +
          'Document E-mail List in Amazon settings, or Amazon discards what we send.',
      },
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') return true
        if (typeof value !== 'string') return 'Enter a Kindle address.'

        const check = checkKindleAddress(value)
        if (check.valid) return true

        switch (check.problem) {
          case 'wrong_domain':
            return `Use the address Amazon gave you — it ends in ${KINDLE_DOMAINS.map(
              (d) => `@${d}`,
            ).join(' or ')}.`
          default:
            return 'That does not look like an email address.'
        }
      },
    },
    {
      name: 'googleId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description:
          'Google’s subject id, set when a reader signs in with Google. Unique so one Google account cannot be linked to two readers. Never edit by hand: it is the identity, and pointing it at another row hands that row’s account to whoever holds the Google login.',
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'avatarUrl',
      type: 'text',
      label: 'Profile picture',
      admin: {
        readOnly: true,
        description:
          'A path on this site (/avatar?v=…), never Google’s URL. The picture is fetched once at sign-in and stored in R2 so readers’ browsers never call googleusercontent.com — see lib/avatars.ts. Re-checked on each sign-in, since Google changes the source URL when the reader changes their photo. Readers who registered with a password have none, and get initials instead.',
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'credits',
      type: 'number',
      defaultValue: SIGNUP_GRANT,
      admin: {
        description:
          'Spendable balance. The credit-ledger collection is the account of how it got here; this is the number the delivery check reads, because summing a ledger per request would be a table scan. Only lib/credits.ts may move it.',
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'creditSharePoints',
      type: 'number',
      defaultValue: 0,
      admin: {
        readOnly: true,
        description:
          'Hundredths of a credit earned from readers sending this uploader’s books, not yet worth a whole credit. A third of a 1-credit book is 0.33 — paid as whole credits that is nothing, forever — so shares accumulate here and pay out on crossing 100. See domain/uploaderShare.ts.',
      },
      access: { create: () => false, update: () => false },
    },
    {
      name: 'creditsGrantedThrough',
      type: 'text',
      admin: {
        readOnly: true,
        description:
          'YYYY-MM of the last month granted. Accrual is lazy — it runs when the reader signs in — and this is what stops a month being paid twice. See domain/credits.ts.',
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      defaultValue: ['reader'],
      options: [
        { label: 'Reader', value: 'reader' },
        { label: 'Editor', value: 'editor' },
        { label: 'Admin', value: 'admin' },
      ],
      access: {
        create: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
        update: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
      },
    },
  ],
}
