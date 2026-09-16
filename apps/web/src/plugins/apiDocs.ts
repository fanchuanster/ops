import type { Endpoint, PayloadRequest, Plugin } from 'payload'
import { openapi, swaggerUI } from 'payload-oapi'

export const SPEC_PATH = '/openapi.json'
export const DOCS_PATH = '/docs'

const AUTH_PATH = '/openapi-auth'

const API_KEY_SCHEME = {
  ApiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description:
      'A personal access token from /account/tokens, sent as `users API-Key <token>`. ' +
      'It carries exactly its owner’s privileges. A browser session cookie authenticates ' +
      'the same way, which is why "Try it out" works while you are signed in.',
  },
}

const isAdmin = (req: PayloadRequest): boolean => Boolean(req.user?.roles?.includes('admin'))

export const routeNotFound = (path: string) =>
  Response.json({ message: `Route not found "${path}"` }, { status: 404 })

function adminOnly(path: string, handler: Endpoint['handler']): Endpoint['handler'] {
  return (req) => (isAdmin(req) ? handler(req) : routeNotFound(`/api${path}`))
}

type Document = Record<string, unknown> & { components?: Record<string, unknown> }

function withApiKeyScheme(handler: Endpoint['handler']): Endpoint['handler'] {
  return async (req) => {
    const generated = await handler(req)
    const spec = (await generated.json()) as Document
    return Response.json({
      ...spec,
      components: { ...spec.components, securitySchemes: API_KEY_SCHEME },
    })
  }
}

export function apiDocs(): Plugin {
  return async (incoming) => {
    const withSpec = await openapi({
      specEndpoint: SPEC_PATH,
      authEndpoint: AUTH_PATH,
      openapiVersion: '3.0',
      metadata: {
        title: 'NobleSee API',
        version: '1.0',
        description:
          'The catalog, accounts, delivery and credit collections, as Payload exposes ' +
          'them over REST. Every request is subject to the same access control the site ' +
          'is — this document describes the surface, not a permission to use it.',
      },
    })(incoming)
    const config = await swaggerUI({ specEndpoint: SPEC_PATH, docsUrl: DOCS_PATH })(withSpec)

    return {
      ...config,
      endpoints: (config.endpoints ?? [])
        .filter((endpoint: Endpoint) => endpoint.path !== AUTH_PATH)
        .map((endpoint: Endpoint) => {
          if (endpoint.path === SPEC_PATH) {
            return {
              ...endpoint,
              handler: adminOnly(SPEC_PATH, withApiKeyScheme(endpoint.handler)),
            }
          }
          if (endpoint.path === DOCS_PATH) {
            return { ...endpoint, handler: adminOnly(DOCS_PATH, endpoint.handler) }
          }
          return endpoint
        }),
    }
  }
}
