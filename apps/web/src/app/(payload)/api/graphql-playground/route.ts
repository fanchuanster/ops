import config from '@payload-config'
import { GRAPHQL_PLAYGROUND_GET } from '@payloadcms/next/routes'

import { adminFromRequest } from '../../../../lib/apiAuth'
import { routeNotFound } from '../../../../plugins/apiDocs'

const playground = GRAPHQL_PLAYGROUND_GET(config)

export async function GET(request: Request): Promise<Response> {
  const { admin } = await adminFromRequest(request)
  if (!admin) return routeNotFound('/api/graphql-playground')
  return playground(request)
}
