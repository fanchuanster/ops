/**
 * Runs the catalog seed against the LIVE production database.
 *
 *   npm run seed:remote
 *
 * Same shape and the same reasoning as `migrate-remote.ts`: `npm run
 * seed` resolves its D1 binding through `wrangler.jsonc` and therefore
 * always writes to the local database, which is deliberate and leaves
 * production with no way to be seeded at all.
 *
 * The seed is idempotent — every book is matched on slug and updated in
 * place — so running this against production repeatedly is safe and is
 * how the library's books get their artifacts and page counts after a
 * schema change.
 *
 * The target is chosen by SEED_TARGET rather than a flag, because
 * `payload run` replaces argv before the script sees it and a `--remote`
 * argument would silently vanish, leaving the script to act on one
 * database while reporting the other.
 */

export {}

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.SEED_TARGET === 'remote'
const configPath = remote ? 'wrangler.remote.jsonc' : 'wrangler.jsonc'

async function main() {
  console.log(
    remote
      ? '\n  Target: PRODUCTION (live D1 via remote bindings)\n'
      : '\n  Target: local D1 in .wrangler/\n',
  )

  // Bindings must be in place before the Payload config is evaluated —
  // it reads env.DB at module scope.
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy({ configPath, envFiles: [] })
  ;(globalThis as Record<symbol, unknown>)[CONTEXT_SYMBOL] = {
    env: proxy.env,
    cf: proxy.cf,
    ctx: proxy.ctx,
  }

  try {
    await import('../src/seed/seed')
  } finally {
    await proxy.dispose()
  }
}

await main()
