import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { BookCollections } from './collections/BookCollections'
import { Books } from './collections/Books'
import { Media } from './collections/Media'
import { Parts } from './collections/Parts'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * Object storage is Cloudflare R2, reached through the S3 API.
 *
 * R2 is S3-compatible, so the client abstraction is unchanged and AWS
 * remains a swap rather than a rewrite — only endpoint, region ("auto")
 * and credentials differ. Chosen over S3/CloudFront because the domain,
 * DNS and tunnel already live on Cloudflare and R2 has no egress fees.
 *
 * Left unset, Payload falls back to local disk so `docker compose up`
 * works with no cloud account — the same posture the previous
 * implementation had.
 */
const r2Configured = Boolean(
  process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
)

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: '— NobleSee',
    },
  },
  collections: [Users, Media, Books, Parts, BookCollections],
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  sharp,
  plugins: r2Configured
    ? [
        s3Storage({
          collections: {
            [Media.slug]: true,
          },
          bucket: process.env.R2_BUCKET || 'noblesee',
          config: {
            endpoint: process.env.R2_ENDPOINT,
            // R2 ignores region but the S3 client requires one.
            region: 'auto',
            credentials: {
              accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
              secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
            },
          },
        }),
      ]
    : [],
})
