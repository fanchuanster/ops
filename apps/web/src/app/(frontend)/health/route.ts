import config from '@payload-config'
import { getPayload } from 'payload'

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
