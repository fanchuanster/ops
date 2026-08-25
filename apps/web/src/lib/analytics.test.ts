import { afterEach, describe, expect, it } from 'vitest'

import { analyticsMeasurementId } from './analytics'

/**
 * The rule worth a test is not "reads an env var" — it is which
 * requests are measured, because getting that wrong is silent: a
 * developer's own clicking shows up as readers and nobody finds out
 * from the code.
 */
describe('which requests are measured', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  const configured = (host: string | null) => {
    process.env.GA_MEASUREMENT_ID = 'G-794BNPG3ZJ'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://noblesee.com'
    return analyticsMeasurementId(host)
  }

  it('measures a request to the canonical site', () => {
    expect(configured('noblesee.com')).toBe('G-794BNPG3ZJ')
  })

  it('ignores the Host header case', () => {
    expect(configured('NobleSee.com')).toBe('G-794BNPG3ZJ')
  })

  it('does not measure local development', () => {
    // `wrangler dev` reads the same `vars` block, so the id IS set
    // here. The host is the only thing telling the two apart.
    expect(configured('localhost:8787')).toBeNull()
  })

  it('does not measure the workers.dev URL', () => {
    expect(configured('noblesee.fanchuanster.workers.dev')).toBeNull()
  })

  it('renders no tag when analytics is not configured', () => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://noblesee.com'
    delete process.env.GA_MEASUREMENT_ID
    expect(analyticsMeasurementId('noblesee.com')).toBeNull()
  })

  it('refuses a measurement id that is not one', () => {
    process.env.GA_MEASUREMENT_ID = 'https://evil.example/x.js#'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://noblesee.com'
    expect(analyticsMeasurementId('noblesee.com')).toBeNull()
  })
})
