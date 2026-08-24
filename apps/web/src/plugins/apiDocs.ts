import type { Endpoint, PayloadRequest, Plugin } from 'payload'
import { openapi, swaggerUI } from 'payload-oapi'

/**
 * Swagger UI and an OpenAPI 3 document for the Payload REST API.
 *
 * The API itself is generated from the collection configs and always
 * has been; what was missing was any way to read it without reading
 * `payload-types.ts`. `payload-oapi` derives the document from the same
 * config, so the docs cannot drift from the API the way a hand-written
 * spec would.
 *
 * Three deliberate departures from what the plugin does out of the box:
 *
 * **Administrators only.** The document names every collection —
 * `credit-ledger`, `entitlements`, `downloads` — and their whole field
 * shape. Access control is unaffected either way (Payload enforces it
 * per request, and a spec grants nothing), so this is not a security
 * boundary; it is a decision not to publish a map of the private parts
 * of the system to anyone who guesses the URL.
 *
 * **404, not 403**, for the same reason `/api/conversion` answers that
 * way: a refusal that distinguishes "not allowed" from "not there"
 * tells an anonymous caller that there is something here to come back
 * for.
 *
 * **No `/openapi-auth`.** The plugin ships an unauthenticated OAuth2
 * password endpoint so Swagger's Authorize button can mint a token.
 * This application already has two ways in — the session cookie, and
 * the personal access tokens minted at `/account/tokens` — and a third
 * credential-taking path, outside the login flow and its lockout, is
 * not worth a button. The security scheme in the document is rewritten
 * to describe the token we actually accept.
 */

/** Both served under Payload's `/api` route: `/api/docs`, `/api/openapi.json`. */
export const SPEC_PATH = '/openapi.json'
export const DOCS_PATH = '/docs'

/** The plugin's own login endpoint, registered and then dropped. */
const AUTH_PATH = '/openapi-auth'

/**
 * The scheme the API really uses.
 *
 * Keyed `ApiKey` because that is the name every generated operation
 * already references — replacing the definition and keeping the name
 * leaves the rest of the document intact.
 */
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

// The same predicate the collections use (`Books.ts`, `Users.ts`), and
// the same one for the same reason: inside the Payload config the
// authenticated user arrives on the request, not from `next/headers`.
const isAdmin = (req: PayloadRequest): boolean => Boolean(req.user?.roles?.includes('admin'))

/**
 * Payload's own answer for a path it does not serve.
 *
 * Copied deliberately, body and all: a refusal that reads differently
 * from "there is nothing here" is a refusal that confirms there is
 * something here.
 */
export const routeNotFound = (path: string) =>
  Response.json({ message: `Route not found "${path}"` }, { status: 404 })

function adminOnly(path: string, handler: Endpoint['handler']): Endpoint['handler'] {
  return (req) => (isAdmin(req) ? handler(req) : routeNotFound(`/api${path}`))
}

/** The parts of the generated document this file touches. */
type Document = Record<string, unknown> & { components?: Record<string, unknown> }

/** Serves the generated document with our own security scheme in it. */
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
    // Both are typed as returning a config or a promise of one, so the
    // composition is awaited rather than nested in one expression.
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
