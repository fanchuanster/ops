/**
 * Stands in for `drizzle-kit/api` in the Worker bundle.
 *
 * Payload's Drizzle layer lazily `require`s drizzle-kit to diff schemas
 * — that is what backs `push: true` and `payload migrate:create`. Both
 * are development-time operations: the adapter is configured with
 * `push: false` and migrations are written to `src/migrations` and
 * checked in, so nothing on the serving path ever reaches this code.
 *
 * It still has to be dealt with, because a lazy `require` is a static
 * dependency as far as a bundler is concerned. Bundling the real thing
 * is not an option: drizzle-kit carries its own copy of esbuild and
 * expects a filesystem and a child-process API that Workers do not
 * have. So it is replaced with functions that throw.
 *
 * Throwing rather than returning empty stubs is the point. If some
 * future change does put a schema-push on the request path, it fails
 * loudly at the call site with an explanation, instead of silently
 * appearing to succeed at migrating a production database.
 */

const unavailable = (name) => () => {
  throw new Error(
    `drizzle-kit's ${name}() is not available on Workers. Schema changes are made ` +
      `with \`./cf npm run migrate:create\` locally and applied with \`./cf npm run migrate\`; ` +
      `nothing should be diffing or pushing schema at runtime.`,
  )
}

export const generateDrizzleJson = unavailable('generateDrizzleJson')
export const generateMigration = unavailable('generateMigration')
export const pushSchema = unavailable('pushSchema')
export const generateSQLiteDrizzleJson = unavailable('generateSQLiteDrizzleJson')
export const generateSQLiteMigration = unavailable('generateSQLiteMigration')
export const pushSQLiteSchema = unavailable('pushSQLiteSchema')
export const upPgSnapshot = unavailable('upPgSnapshot')
export const upSQLiteSnapshot = unavailable('upSQLiteSnapshot')

export default {
  generateDrizzleJson,
  generateMigration,
  pushSchema,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
  pushSQLiteSchema,
  upPgSnapshot,
  upSQLiteSnapshot,
}
