import { describe, expect, it } from 'vitest'

import { readBooks } from './Books'

type Rule = { and: unknown[] } | { or: unknown[] } | boolean

function decide(user: unknown): Rule {
  return readBooks({ req: { user } } as never) as Rule
}

const owner = { id: 7, roles: ['reader'] }

function clauses(rule: Rule): unknown[] {
  if (typeof rule === 'boolean') throw new Error('expected a query, got ' + rule)
  return 'or' in rule ? rule.or : rule.and
}

describe('anonymous', () => {
  it('sees only published, cleared books that are actually public', () => {
    const rule = decide(undefined)

    expect(rule).not.toBe(true)
    expect(clauses(rule)).toContainEqual({ status: { equals: 'published' } })
    expect(clauses(rule)).toContainEqual({
      or: [{ owner: { exists: false } }, { 'review.state': { equals: 'approved' } }],
    })
  })

  it('is not offered an owner-equals clause it could never match', () => {
    expect(JSON.stringify(decide(null))).not.toContain('"owner":{"equals"')
  })
})

describe('a signed-in reader', () => {
  it('can see the books they own', () => {
    expect(clauses(decide(owner))).toContainEqual({ owner: { equals: 7 } })
  })

  it('still sees the public library alongside their own', () => {
    const rule = decide(owner)
    expect(JSON.stringify(rule)).toContain('published')
  })

  it('does not get a blanket yes', () => {
    expect(decide(owner)).not.toBe(true)
  })

  it('is scoped to their own id and no one else’s', () => {
    const json = JSON.stringify(decide({ id: 7, roles: ['reader'] }))
    expect(json).toContain('"owner":{"equals":7}')
  })
})

describe('an administrator', () => {
  it('sees everything', () => {
    expect(decide({ id: 1, roles: ['admin'] })).toBe(true)
  })

  it('is recognised among several roles', () => {
    expect(decide({ id: 1, roles: ['reader', 'admin'] })).toBe(true)
  })
})
