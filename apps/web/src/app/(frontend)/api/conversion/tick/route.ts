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
    return null
  }
}

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

  await advanceMasterPipeline(payload)

  let result
  try {
    result = await runOneJob((await getCloudflareContext({ async: true })).env as never)
  } catch (error) {
    logError('conversion tick', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...result })
}
