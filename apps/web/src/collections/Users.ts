import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { KINDLE_DOMAINS, KINDLE_SENDER_ADDRESS, checkKindleAddress } from '../domain/kindle'
import { checkPassword } from '../domain/password'

/**
 * Identity lives in Payload (auth, sessions, password reset), while the
 * domain keys off `user_id` alone and never imports a Payload user
 * object. That is the boundary that keeps section 7's "NobleSee owns
 * the domain concepts" true, and leaves room to move identity out later
 * without touching business logic.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: 'Administration',
  },
  hooks: {
    // The password rule has to live here for the same reason the roles
    // rule lives at field level: there is more than one door. The
    // sign-up form, `POST /api/users`, the admin UI and the
    // create-admin script all reach the collection, and only the first
    // of them ever saw the check that used to sit in the server action.
    // A hook runs on all of them, including calls made with
    // `overrideAccess: true`, which skips access control but not hooks.
    beforeValidate: [
      ({ data, operation }) => {
        // Only when a password is actually being set: ordinary updates
        // carry no password field, and rejecting those would make every
        // profile edit fail.
        if (operation === 'create' || typeof data?.password === 'string') {
          const problem = checkPassword(data?.password)
          if (problem) throw new APIError(problem.message, 400)
        }
        return data
      },
    ],
  },
  access: {
    // Anyone may register. What they may register *as* is constrained at
    // the field level below, so the guarantee holds no matter which door
    // the request came through — the sign-up form, the REST API, or
    // anything added later.
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
        // Empty is how a reader turns delivery off, so it must stay
        // valid — this field is optional by design.
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
        // Readers must not be able to promote themselves — section 34.
        // Both directions are needed: `update` stops an existing reader
        // escalating, `create` stops someone registering as an admin in
        // the first place, which is the hole that opens the moment
        // public sign-up exists.
        create: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
        update: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
      },
    },
  ],
}
