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

/**
 * Whether the GraphQL playground at `/api/graphql-playground` is on.
 *
 * Payload gates both the playground and schema introspection on
 * `NODE_ENV`, which does not distinguish what we mean by production: an
 * OpenNext bundle is always built as production, so the local
 * `wrangler dev` server is "production" too and the playground would
 * 404 on the very machine it exists for.
 *
 * So the switch is an environment variable instead, and deliberately
 * one that lives in `.dev.vars` — a file that is git-ignored and never
 * deployed. Introspection is what makes the playground worth opening,
 * and introspection cannot be gated by role the way the REST document
 * is (it is an ordinary query to `/api/graphql`). Leaving this unset
 * in production is therefore the whole protection, and the route's own
 * administrator check is the second lock, not the first.
 */
const graphqlPlayground = process.env.PAYLOAD_GRAPHQL_PLAYGROUND === '1'

export default buildConfig({
  serverURL,
  cors: [serverURL],
  csrf: [serverURL],
  graphQL: {
    disablePlaygroundInProduction: !graphqlPlayground,
    disableIntrospectionInProduction: !graphqlPlayground,
  },
  /**
   * There is no generated admin panel. `/admin` is NobleSee's own
   * editorial UI and the only one.
   *
   * Payload's admin lived at `/cms` until 2026-08-24, as the tool for
   * everything the editorial UI had no screen for. What it was actually
   * still needed for came down to two acts — granting the admin role
   * and correcting an email — and both are now on `/admin/users`. The
   * rest of what it offered was either unreachable anyway (credits
   * refuse writes at field level) or a ledger nobody was reading.
   *
   * Deleting the route folder is how Payload itself says to do this;
   * `admin.disable` is deprecated. The win is the bundle: the admin UI
   * was most of a Worker that had grown to 7.7 MB gzipped against a
   * 10 MB limit, and nothing imports `@payloadcms/next/views` now.
   *
   * `admin.user` stays because it names the auth collection, which is
   * not an admin-panel concern. `importMap` is gone with the file it
   * pointed at, and so is the `generate:importmap` script.
   *
   * What went with it, honestly: a browser view of the Downloads,
   * Entitlements, CreditLedger and ReadingProgress collections for
   * anyone other than yourself, and the Media list. Each is reachable
   * through the REST API under `(payload)/api`, which is deliberately
   * still here.
   */
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
    // Swagger UI at /api/docs and the document at /api/openapi.json,
    // both administrators-only. See `plugins/apiDocs.ts`.
    apiDocs(),
  ],
})
