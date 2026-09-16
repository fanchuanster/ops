import worker from 'open-next-worker'

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from 'open-next-worker'

interface Env {
  CONVERTER_SECRET?: string
  NEXT_PUBLIC_SERVER_URL?: string
}

const TICK_PATH = '/api/conversion/tick'

export default {
  fetch: worker.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.CONVERTER_SECRET) return

    const origin = env.NEXT_PUBLIC_SERVER_URL ?? 'https://noblesee.com'
    const request = new Request(`${origin}${TICK_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CONVERTER_SECRET}` },
    })

    ctx.waitUntil(
      (async () => {
        const response = await worker.fetch(request, env, ctx)
        const body = await response.text()
        if (!response.ok) {
          console.error(`conversion tick: HTTP ${response.status} ${body.slice(0, 200)}`)
        }
      })(),
    )
  },
}
