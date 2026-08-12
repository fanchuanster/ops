import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * Checks the database rather than merely returning 200.
 *
 * A Worker that boots but cannot reach D1 is not healthy, and the
 * difference only shows up if something actually issues a query. The
 * cheapest honest check is a bounded read through Payload itself, which
 * exercises the binding, the adapter and the schema in one go.
 */
export async function GET() {
  try {
    const payload = await getPayload({ config })
    await payload.count({ collection: 'books', overrideAccess: true })
    return Response.json({ status: 'ok', database: 'ok' })
  } catch (error) {
    return Response.json(
      { status: 'unhealthy', database: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    )
  }
}
