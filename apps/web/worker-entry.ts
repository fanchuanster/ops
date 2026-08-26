/**
 * The Worker's entry point: OpenNext's handler, plus a clock.
 *
 * `wrangler.jsonc` points `main` here rather than straight at
 * `.open-next/worker.js`, for one reason — a Worker can only have one
 * entry point and OpenNext's has no `scheduled` handler. Everything
 * about the request path is unchanged: `fetch` is OpenNext's own, and
 * the Durable Object classes are re-exported because Cloudflare resolves
 * a binding's class name against the entry module.
 *
 * ## Why this file is nearly empty
 *
 * It is compiled separately from the Next bundle. Anything imported here
 * is bundled *again*, next to a Worker already at 6.9 MB of a 10 MB
 * limit — and the conversion runner reaches Payload, every collection
 * config and the D1 adapter, which is most of that 6.9 MB. So the
 * scheduled handler does not import the runner. It asks the Worker's own
 * fetch handler for the tick route, which runs inside the Next bundle
 * where all of that already lives.
 *
 * The request is constructed here and handed straight to `fetch`; it
 * never reaches the network, and no route is exposed that was not
 * exposed before.
 */

// Resolved to `.open-next/worker.js` by wrangler's `alias`, and to
// `types/openNextWorker.ts` by tsconfig's `paths`. See either file for
// why the specifier is indirect rather than a relative path.
import worker from 'open-next-worker'

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from 'open-next-worker'

interface Env {
  CONVERTER_SECRET?: string
  NEXT_PUBLIC_SERVER_URL?: string
}

const TICK_PATH = '/api/conversion/tick'

export default {
  fetch: worker.fetch,

  /**
   * One tick of the conversion clock.
   *
   * Advances the Adobe export stages and runs at most one conversion or
   * correction job. Both are the tick route's business; this only says
   * when.
   *
   * With no secret set the route 404s and this does nothing — which is
   * the same fail-closed behaviour the converter handoff had, and means
   * a Worker deployed ahead of the secret simply does not convert rather
   * than converting for anyone who asks.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.CONVERTER_SECRET) return

    const origin = env.NEXT_PUBLIC_SERVER_URL ?? 'https://noblesee.com'
    const request = new Request(`${origin}${TICK_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CONVERTER_SECRET}` },
    })

    // Awaited inside `waitUntil` rather than returned: a scheduled
    // invocation ends when the handler resolves, and a conversion is
    // slower than that.
    ctx.waitUntil(
      (async () => {
        const response = await worker.fetch(request, env, ctx)
        // Read the body so the response is not discarded mid-stream,
        // and so a failure is visible in the tail log rather than silent.
        const body = await response.text()
        if (!response.ok) {
          console.error(`conversion tick: HTTP ${response.status} ${body.slice(0, 200)}`)
        }
      })(),
    )
  },
}
