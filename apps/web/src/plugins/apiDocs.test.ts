/**
 * The gate in front of the API documentation.
 *
 * Two properties are worth pinning, and neither is visible from reading
 * the plugin composition: that the OAuth password endpoint the upstream
 * plugin registers is really gone, and that an anonymous caller gets a
 * 404 rather than the document. Both are one line of the config away
 * from silently reverting when `payload-oapi` is upgraded.
 */

import type { Config, Endpoint } from 'payload'
import { describe, expect, it } from 'vitest'

import { DOCS_PATH, SPEC_PATH, apiDocs } from './apiDocs'

/** The plugin only ever reads `endpoints`, so this is the whole input. */
async function endpoints(): Promise<Endpoint[]> {
  const config = await apiDocs()({ endpoints: [] } as unknown as Config)
  return (config.endpoints ?? []) as Endpoint[]
}

const request = (user: unknown) => ({ user, headers: new Headers() }) as never

describe('the registered endpoints', () => {
  it('serves the document and the UI', async () => {
    const paths = (await endpoints()).map((endpoint) => endpoint.path)

    expect(paths).toContain(SPEC_PATH)
    expect(paths).toContain(DOCS_PATH)
  })

  it('does not register a second way to log in', async () => {
    const posts = (await endpoints()).filter((endpoint) => endpoint.method === 'post')

    expect(posts).toEqual([])
  })
})

describe('who may read it', () => {
  it('hides the UI from an anonymous caller', async () => {
    const docs = (await endpoints()).find((endpoint) => endpoint.path === DOCS_PATH)!

    const refusal = await docs.handler(request(undefined))

    expect(refusal.status).toBe(404)
    // Word for word what Payload answers for a path it does not serve.
    expect(await refusal.json()).toEqual({ message: 'Route not found "/api/docs"' })
  })

  it('hides it from a signed-in reader too', async () => {
    const docs = (await endpoints()).find((endpoint) => endpoint.path === DOCS_PATH)!

    expect((await docs.handler(request({ id: 7, roles: ['reader'] }))).status).toBe(404)
  })

  it('hides the document itself, not only the page around it', async () => {
    const spec = (await endpoints()).find((endpoint) => endpoint.path === SPEC_PATH)!

    expect((await spec.handler(request({ id: 7, roles: ['reader'] }))).status).toBe(404)
  })

  it('answers an administrator', async () => {
    const docs = (await endpoints()).find((endpoint) => endpoint.path === DOCS_PATH)!
    const response = await docs.handler(request({ id: 1, roles: ['admin'] }))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('swagger-ui')
  })
})
