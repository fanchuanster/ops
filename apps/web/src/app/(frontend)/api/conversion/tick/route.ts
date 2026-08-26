/**
 * The conversion clock.
 *
 * Until 2026-08-26 there was no clock: the converter container polled
 * `GET /api/conversion` for work, and that poll was used as the tick —
 * each one advanced at most one book's Adobe export before answering.
 * The container is gone (CLAUDE.md section 13) and the work moved into
 * this Worker, so the poll went with it and something has to take its
 * place. That something is a Cloudflare cron trigger, and this is what
 * it calls.
 *
 * ## Why a route and not the scheduled handler directly
 *
 * `worker-entry.ts` is a wrapper around the OpenNext bundle and is
 * compiled separately from it. Importing the runner there would pull
 * Payload, the collection configs and the D1 adapter into a *second*
 * bundle — the same code twice, in a Worker already at 6.9 MB of a 10 MB
 * limit. So the scheduled handler makes a request to this route instead,
 * which runs inside the Next bundle where all of that already lives. The
 * request never leaves the Worker.
 *
 * ## Authentication
 *
 * The same shared secret the converter used, compared the same way and
 * for the same reason: this route runs conversions and writes artifacts,
 * so anyone who could call it could spend Adobe transactions and money
 * at a third-party model.
 *
 * The name `CONVERTER_SECRET` is now slightly historical — there is no
 * converter — but it is deliberately not renamed. Renaming it means a
 * `wrangler secret put` that has to land before the deploy, and if it
 * does not, this route fails closed and conversions stop silently. The
 * name is a smaller problem than that.
 *
 * **Fail closed**: with no secret configured the route 404s as though it
 * does not exist, so a Worker deployed before the secret is set exposes
 * nothing.
 */

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { runOneJob } from '../../../../../lib/conversion/runner'
import { advanceMasterPipeline } from '../../../../../lib/masterPipeline'
import { logError } from '../../../../../lib/logError'

export const dynamic = 'force-dynamic'

async function conversionSecret(): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const secret = (env as { CONVERTER_SECRET?: string }).CONVERTER_SECRET
    return secret && secret.length >= 16 ? secret : null
  } catch {
    // Not logged. This throws on every request that runs without
    // Cloudflare bindings, which is how a local process discovers it has
    // none — control flow, not a failure.
    return null
  }
}

/**
 * Length-independent, timing-safe comparison.
 *
 * `===` on secrets leaks their prefix through response timing. The
 * lengths are hashed first so the comparison itself is fixed-width
 * whatever the caller sends.
 */
async function matches(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!
  return diff === 0
}

export async function POST(request: Request) {
  const expected = await conversionSecret()
  if (!expected) return new NextResponse(null, { status: 404 })

  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented || !(await matches(presented, expected))) {
    return new NextResponse(null, { status: 401 })
  }

  const payload = await getPayload({ config })

  // The Adobe stages first, and always — including when a job runs
  // afterwards. These are the export handoffs, which are I/O and cost
  // this tick almost nothing; skipping them whenever there was
  // conversion work to do is what would leave a scan waiting on a queue
  // it is not even in yet.
  await advanceMasterPipeline(payload)

  let result
  try {
    result = await runOneJob((await getCloudflareContext({ async: true })).env as never)
  } catch (error) {
    // A tick must never take the cron down: the next one is a minute
    // away and would hit the same failure with nothing recorded.
    logError('conversion tick', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...result })
}
