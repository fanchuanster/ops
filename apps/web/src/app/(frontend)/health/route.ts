import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * Checks the database rather than merely returning 200, so a container
 * that is up but cannot reach PostgreSQL reports unhealthy. That
 * distinction is what makes `depends_on: service_healthy` meaningful.
 */
export async function GET() {
  try {
    const payload = await getPayload({ config })
    await payload.db.pool.query('SELECT 1')
    return Response.json({ status: 'ok', database: 'ok' })
  } catch (error) {
    return Response.json(
      { status: 'unhealthy', database: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    )
  }
}
