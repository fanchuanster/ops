import { withPayload } from '@payloadcms/next/withPayload'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

initOpenNextCloudflareForDev()

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },

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
