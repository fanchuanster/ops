import type { CollectionConfig } from 'payload'

import { COVER_MIME_TYPES } from '../domain/cover'

/** Covers and editorial imagery. Book artifacts are NOT media — see Parts. */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: {
    read: () => true,
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
