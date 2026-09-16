export {}

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.COVER_TARGET === 'remote'
const configPath = remote ? 'wrangler.remote.jsonc' : 'wrangler.jsonc'
const alsoFailed = process.env.COVER_INCLUDE_FAILED === '1'

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

    const states = alsoFailed ? ['rendering', 'failed'] : ['rendering']

    const stuck = await payload.find({
      collection: 'books',
      where: { 'generatedCover.state': { in: states } },
      limit: 500,
      depth: 0,
      overrideAccess: true,
    })

    if (stuck.docs.length === 0) {
      console.log('  Nothing stuck.\n')
      return
    }

    for (const book of stuck.docs) {
      await payload.update({
        collection: 'books',
        id: book.id,
        data: { generatedCover: { state: 'pending', key: null, candidates: 1, page: 1 } },
        overrideAccess: true,
      })
      console.log(`  requeued  ${book.id}  ${book.slug}`)
    }

    console.log(`\n  ${stuck.docs.length} book(s) back to pending.\n`)
  } finally {
    await proxy.dispose()
  }
}

await main()
process.exit(0)
