import type { CollectionConfig } from 'payload'

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
