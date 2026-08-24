import config from '@payload-config'
import { GRAPHQL_PLAYGROUND_GET } from '@payloadcms/next/routes'

import { adminFromRequest } from '../../../../lib/apiAuth'
import { routeNotFound } from '../../../../plugins/apiDocs'

/**
 * A browsable GraphQL client, for local work.
 *
 * `/api/graphql` is POST-only, so without this the schema can only be
 * read by dumping it (`npx payload-graphql generate:schema`). The
 * playground introspects it live and is the quickest way to answer
 * "what can I ask for".
 *
 * Two locks, and the order matters. The outer one is
 * `PAYLOAD_GRAPHQL_PLAYGROUND` in `.dev.vars` (see `payload.config.ts`):
 * unset, Payload's own handler answers 404 and introspection stays off.
 * The inner one is this administrator check, which is what keeps the
 * page itself off a production deploy where someone has turned the
 * outer switch on. Neither is sufficient alone — introspection is a
 * plain query to `/api/graphql` and no check here can gate it.
 */
const playground = GRAPHQL_PLAYGROUND_GET(config)

export async function GET(request: Request): Promise<Response> {
  const { admin } = await adminFromRequest(request)
  if (!admin) return routeNotFound('/api/graphql-playground')
  return playground(request)
}
