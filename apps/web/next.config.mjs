import { withPayload } from '@payloadcms/next/withPayload'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/**
 * Makes the Worker bindings — D1 and R2 — available under `next dev`,
 * backed by wrangler's local Miniflare. Without it the Payload config's
 * `getCloudflareContext()` has nothing to resolve and the dev server
 * cannot reach a database at all.
 */
initOpenNextCloudflareForDev()

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Books do NOT come through here. The conversion portal posts the
      // file to `api/upload/route.ts` as a raw request body, precisely
      // so it is never parsed into memory — see MAX_UPLOAD_BYTES in
      // `src/domain/publication.ts` for why that decides the limit.
      //
      // This governed the upload until 2026-08-24 and had to sit above
      // the whole book (66mb) as a result. What is left are ordinary
      // form actions — book details, rights, review — none of which
      // carries a file. 4mb is generous for those and is small enough
      // that a stray large action body is a bug rather than a bill.
      //
      // Still set explicitly rather than left to default: the default
      // is 1 MB, and rediscovering that at the moment some future form
      // grows an attachment is exactly the afternoon this comment is
      // meant to save.
      bodySizeLimit: '4mb',
    },
  },

  // No `output: 'standalone'`. That was for the container image;
  // OpenNext produces the Worker bundle from the ordinary build output
  // and standalone mode would fight it.

  // Keep drizzle-kit out of the Worker. Payload's Drizzle layer
  // `require`s it lazily for schema diffing, which never happens at
  // runtime here — but a lazy require is still a static edge to a
  // bundler, and the real package pulls in its own esbuild and expects
  // a filesystem. See the stub for the full reasoning.
  turbopack: {
    resolveAlias: {
      'drizzle-kit/api': './src/lib/drizzle-kit-stub.mjs',
    },
  },
  webpack: (config) => {
    config.resolve.alias['drizzle-kit/api'] = new URL(
      './src/lib/drizzle-kit-stub.mjs',
      import.meta.url,
    ).pathname
    return config
  },
}

export default withPayload(nextConfig)
