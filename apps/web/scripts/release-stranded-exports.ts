/**
 * Frees books stuck at `queued` holding an export that will never finish.
 *
 *   npm run release-exports            local D1
 *   npm run release-exports:remote     the LIVE database
 *
 * `needsMasterRun` refuses to start phase 1 for a book that already
 * carries an `exportJob`, so that one book is not sent to Adobe twice.
 * Until 2026-09-14 the only thing that ever cleared that handle was
 * `attachMaster`, which runs on success — every failure path spread the
 * stored conversion unchanged. So a book whose export failed after
 * Adobe had accepted the job kept the job URL, and "Try again" or any
 * save from the details form put it back to `queued` with the handle
 * still on it. `advanceRunningMaster` only looks at `ocr`, so neither
 * half of phase 1 owned it: it sat at "Waiting to be converted" for
 * ever, with no message and nothing in the log.
 *
 * `releasedExportHandle` in `domain/pipeline.ts` is the fix, and it
 * only applies from now on. This is the one-shot repair for rows
 * already in that state.
 *
 * Safe to re-run, and safe to run while the cron is ticking: a *live*
 * export is `ocr`, never `queued`, because `startMasterFor` writes the
 * state and the handle in the same update. So every row this matches is
 * by construction holding a handle nothing will ever poll.
 *
 * The Adobe asset is not deleted. It expires by itself after a day, and
 * this runs long after that — the alternative is asking Adobe about
 * jobs from a failure we already know we lost.
 */

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

    // `exists` is true for an empty string on some adapters, so the
    // real test is done here rather than trusted to the query.
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
            // The message the failure left, if the book was re-queued
            // from the details form, which does not clear it. The book
            // is about to be tried again; a stale "could not be read"
            // under it would describe the wrong attempt.
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
