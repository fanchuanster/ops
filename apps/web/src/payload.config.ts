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

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * The Worker's bindings: the D1 database and the R2 bucket.
 *
 * Resolved with a top-level await because Payload needs a live binding
 * at config-construction time, not a connection string it can open
 * later. Inside the Worker this reads the running request's context;
 * under `next dev` and the Payload CLI it falls through to wrangler's
 * local Miniflare proxy, which is why the CLI scripts in package.json
 * set NEXT_RUNTIME=nodejs — without it `getCloudflareContext` has no
 * way to know it is allowed to reach for wrangler.
 *
 * Bindings replace the previous DATABASE_URI and the R2 access keys
 * entirely. A binding is a capability granted to this Worker, so there
 * is no credential in the environment for an attacker to lift and
 * replay from somewhere else.
 */
const { env } = await getCloudflareContext({ async: true })

/**
 * The site's own public origin.
 *
 * Payload uses it to build absolute URLs and — more importantly — to
 * scope CSRF and CORS. Listed explicitly rather than wildcarded: an
 * open CORS policy here would let any origin drive an authenticated
 * session against the API.
 */
const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8787'

export default buildConfig({
  serverURL,
  cors: [serverURL],
  csrf: [serverURL],
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: '— NobleSee',
    },
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
    // Migrations are explicit and checked in. Never let the adapter
    // push schema changes at boot: on D1 that would mean an unreviewed
    // ALTER running against production on every cold start.
    push: false,
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  /**
   * No `sharp`.
   *
   * It is a native binary and cannot run on Workers. Losing it means
   * Payload stops generating resized image variants for uploads; cover
   * images are served at the size they were uploaded and resized by
   * Cloudflare's image resizing at the edge instead. Nothing else in
   * the application depends on it.
   */
  plugins: [
    r2Storage({
      collections: {
        [Media.slug]: true,
      },
      bucket: env.ARTIFACTS,
    }),
  ],
})
