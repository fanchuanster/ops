/**
 * Who may see which books.
 *
 * The rule is small and returns a query rather than a boolean, which is
 * exactly why it is worth testing directly: a wrong `Where` here does
 * not throw, it silently subtracts books from the answer. That is how
 * the 2026-08-17 bug behaved — a reader's own upload vanished from
 * their own reader and surfaced as a bare 404, with nothing logged.
 */

import { describe, expect, it } from 'vitest'

import { readBooks } from './Books'

type Rule = { and: unknown[] } | { or: unknown[] } | boolean

/** The rule only ever reads `req.user`, so this is the whole input. */
function decide(user: unknown): Rule {
  return readBooks({ req: { user } } as never) as Rule
}

const owner = { id: 7, roles: ['reader'] }

function clauses(rule: Rule): unknown[] {
  if (typeof rule === 'boolean') throw new Error('expected a query, got ' + rule)
  return 'or' in rule ? rule.or : rule.and
}

describe('anonymous', () => {
  it('sees only public, published, cleared books', () => {
    const rule = decide(undefined)

    expect(rule).not.toBe(true)
    expect(clauses(rule)).toContainEqual({ visibility: { equals: 'public' } })
    expect(clauses(rule)).toContainEqual({ status: { equals: 'published' } })
  })

  it('is not offered an owner clause it could never match', () => {
    expect(JSON.stringify(decide(null))).not.toContain('owner')
  })
})

describe('a signed-in reader', () => {
  it('can see the books they own', () => {
    // The bug: without this the reader's own private upload is filtered
    // out of getBookBySlug and /read/<slug> answers 404.
    expect(clauses(decide(owner))).toContainEqual({ owner: { equals: 7 } })
  })

  it('still sees the public library alongside their own', () => {
    const rule = decide(owner)
    expect(JSON.stringify(rule)).toContain('published')
  })

  it('does not get a blanket yes', () => {
    // What this returned until 2026-08-17. Every account could read
    // every other account's private upload, with only the artifact
    // boundary — the *second* check — in the way.
    expect(decide(owner)).not.toBe(true)
  })

  it('is scoped to their own id and no one else’s', () => {
    const json = JSON.stringify(decide({ id: 7, roles: ['reader'] }))
    expect(json).toContain('"owner":{"equals":7}')
  })
})

describe('an administrator', () => {
  it('sees everything', () => {
    // Otherwise the editorial workflow cannot review what it is asked
    // to approve: a submission is a private book by definition.
    expect(decide({ id: 1, roles: ['admin'] })).toBe(true)
  })

  it('is recognised among several roles', () => {
    expect(decide({ id: 1, roles: ['reader', 'admin'] })).toBe(true)
  })
})
