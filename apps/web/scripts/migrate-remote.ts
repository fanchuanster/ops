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
