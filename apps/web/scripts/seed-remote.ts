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
