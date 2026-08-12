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
