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
        update: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
      },
    },
  ],
}
