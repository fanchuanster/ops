export {}

const CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

const remote = process.env.EXPORT_TARGET === 'remote'
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

    const stranded = await payload.find({
      collection: 'books',
      where: {
        and: [
          { 'conversion.state': { equals: 'queued' } },
          { 'conversion.exportJob': { exists: true } },
        ],
      },
      limit: 500,
      depth: 0,
      overrideAccess: true,
    })

    const docs = stranded.docs.filter((book) => Boolean(book.conversion?.exportJob))

    if (docs.length === 0) {
      console.log('  Nothing stranded.\n')
      return
    }

    for (const book of docs) {
      await payload.update({
        collection: 'books',
        id: book.id,
        data: {
          conversion: {
            ...book.conversion,
            exportJob: null,
            exportAsset: null,
            exportStartedAt: null,
            message: null,
          },
        },
        overrideAccess: true,
      })
      console.log(`  released  ${book.id}  ${book.slug}`)
    }

    console.log(`\n  ${docs.length} book(s) released; the next tick will start them.\n`)
  } finally {
    await proxy.dispose()
  }
}

await main()
process.exit(0)
