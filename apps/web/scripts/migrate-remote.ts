/**
 * Applies pending schema migrations to the LIVE production database.
 *
 *   npm run migrate:remote
 *
 * `npm run migrate` resolves its D1 binding through `wrangler.jsonc` and
 * therefore always targets the local database in `.wrangler/`. That is
 * deliberate (see the header of `wrangler.remote.jsonc`), and it leaves
 * production with no way to be migrated at all — which is what this
 * script is for.
 *
 * It runs Payload's own migration runner rather than executing the SQL
 * by hand with `wrangler d1 execute`. The runner is what writes the
 * `payload_migrations` bookkeeping row, and a migration applied without
 * that row would be re-applied on the next run — against a schema that
 * already has the columns, which fails partway through and leaves the
 * database in a state no migration describes.
 *
 * The target is chosen by MIGRATE_TARGET rather than a command-line
 * flag, for the same reason `create-admin.ts` uses ADMIN_TARGET:
 * `payload run` replaces argv before the script sees it, so a `--remote`
 * argument silently vanishes and the script would act on the wrong
 * database while reporting success.
 *
 * Order matters when deploying. Migrate first, then deploy the Worker:
 * the new code queries columns the old schema does not have, so a Worker
 * shipped ahead of its migration serves errors until the migration
 * lands. The reverse order is safe because these migrations are
 * additive — the old code simply ignores the new columns.
 */

// Everything below is imported dynamically, after the Cloudflare context
// global is seeded — so this file has no static import to mark it a
// module, and top-level `await` would not be allowed without this.
export {}

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.MIGRATE_TARGET === 'remote'
const configPath = remote ? 'wrangler.remote.jsonc' : 'wrangler.jsonc'

async function main() {
  console.log(
    remote
      ? '\n  Target: PRODUCTION (live D1 via remote bindings)\n'
      : '\n  Target: local D1 in .wrangler/\n',
  )

  // Bindings must be in place before the Payload config is evaluated —
  // it reads env.DB at module scope. Seeding the context global lets
  // getCloudflareContext short-circuit before it looks for a config file
  // of its own, which is what lets this script choose local vs remote.
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy({ configPath, envFiles: [] })
  ;(globalThis as Record<symbol, unknown>)[CONTEXT_SYMBOL] = {
    env: proxy.env,
    cf: proxy.cf,
    ctx: proxy.ctx,
  }

  try {
    const { default: config } = await import('@payload-config')
    const { getPayload } = await import('payload')
    const payload = await getPayload({ config })

    const status = await payload.db.migrationDir
    console.log(`  Reading migrations from ${status}\n`)

    await payload.db.migrate()

    console.log('\n  Done.\n')
  } finally {
    await proxy.dispose()
  }
}

await main()
process.exit(0)
