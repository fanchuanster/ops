import path from 'path'
import { fileURLToPath } from 'url'

import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { r2Storage } from '@payloadcms/storage-r2'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { buildConfig } from 'payload'

import { BookCollections } from './collections/BookCollections'
import { CreditLedger } from './collections/CreditLedger'
import { Downloads } from './collections/Downloads'
import { Entitlements } from './collections/Entitlements'
import { Books } from './collections/Books'
import { Media } from './collections/Media'
import { ReadingProgress } from './collections/ReadingProgress'
import { Users } from './collections/Users'
import { apiDocs } from './plugins/apiDocs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const { env } = await getCloudflareContext({ async: true })

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8787'

const graphqlPlayground = process.env.PAYLOAD_GRAPHQL_PLAYGROUND === '1'

export default buildConfig({
  serverURL,
  cors: [serverURL],
  csrf: [serverURL],
  graphQL: {
    disablePlaygroundInProduction: !graphqlPlayground,
    disableIntrospectionInProduction: !graphqlPlayground,
  },
  admin: {
    user: Users.slug,
  },
  collections: [
    Users,
    Media,
    Books,
    BookCollections,
    Downloads,
    Entitlements,
    CreditLedger,
    ReadingProgress,
  ],
  editor: lexicalEditor(),
  db: sqliteD1Adapter({
    binding: env.DB,
    push: false,
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  plugins: [
    r2Storage({
      collections: {
        [Media.slug]: true,
      },
      bucket: env.ARTIFACTS,
    }),
    apiDocs(),
  ],
})
