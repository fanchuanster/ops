import type { CollectionConfig } from 'payload'

import { COVER_MIME_TYPES } from '../domain/cover'

/** Covers and editorial imagery. Book artifacts are NOT media — see Parts. */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: {
    /**
     * Administrators only, since 2026-08-25. This was `() => true`.
     *
     * Media is one thing: book covers. They are shown through
     * `/covers/<id>`, which asks the Books access rule before it
     * streams — so a private upload's cover is its owner's, exactly as
     * a rendered page of it already was. A public read here is a second
     * door around that check, and an unlocked one: the file lives at
     * `/api/media/file/<filename>` under whatever the uploader called
     * their file, which is `cover.jpg` more often than it is anything
     * unguessable.
     *
     * It mattered less when only administrators could upload a cover,
     * because they upload for books already in the library. Owners can
     * upload for their own private drafts now
     * (`app/(frontend)/actions/cover.ts`), so the hole became a real
     * one and is closed here rather than papered over with a warning.
     *
     * Nothing in the application reads media through this rule: every
     * cover is served by the route, which reads with
     * `overrideAccess: true` having already checked the book.
     */
    read: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
  },
  upload: {
    /**
     * An allowlist, not `image/*`, which is what this was until
     * 2026-08-24.
     *
     * `image/svg+xml` matches `image/*` and is a script container. Media
     * is served from this site's own origin, so an uploaded SVG is
     * stored XSS — the browser runs it against noblesee.com with a
     * session cookie attached. The list lives in `domain/cover.ts`
     * beside the size rule, and is enforced here as well so it holds
     * for every writer rather than only for the screen that uploads.
     */
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
