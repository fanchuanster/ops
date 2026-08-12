import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the runtime image small: only the files the
  // server actually needs are copied, not the whole node_modules tree.
  output: 'standalone',
}

export default withPayload(nextConfig)
