import { describe, expect, it } from 'vitest'

import { checkAccountEmail, checkRoleChange } from './accounts'

describe('checkAccountEmail', () => {
  it('normalises case and surrounding space', () => {
    expect(checkAccountEmail('  Reader@Example.COM ')).toEqual({
      valid: true,
      email: 'reader@example.com',
    })
  })

  // Every homegrown tightening of the grammar eventually refuses a real
  // reader, so these have to keep working.
  it('accepts the addresses a strict pattern would refuse', () => {
    for (const address of ["o'brien@example.com", 'reader+books@example.co.uk', 'a@b.io']) {
      expect(checkAccountEmail(address)).toEqual({ valid: true, email: address })
    }
  })

  it('refuses what is not an address at all', () => {
    for (const bad of ['', '   ', 'reader', 'reader@', '@example.com', 'reader@example']) {
      expect(checkAccountEmail(bad).valid).toBe(false)
    }
  })

  it('refuses an address with a space in it, which is a paste gone wrong', () => {
    expect(checkAccountEmail('reader @example.com')).toEqual({
      valid: false,
      problem: 'malformed',
    })
  })

  it('refuses a domain that begins or ends with a dot', () => {
    expect(checkAccountEmail('reader@.com').valid).toBe(false)
    expect(checkAccountEmail('reader@example.').valid).toBe(false)
  })
})

describe('checkRoleChange', () => {
  it('refuses withdrawing your own admin role', () => {
    expect(checkRoleChange({ actorId: 1, targetId: 1, makeAdmin: false })).toEqual({
      ok: false,
      refusal: 'self_demotion',
    })
  })

  it('allows everything else, including demoting another admin', () => {
    expect(checkRoleChange({ actorId: 1, targetId: 2, makeAdmin: false }).ok).toBe(true)
    expect(checkRoleChange({ actorId: 1, targetId: 2, makeAdmin: true }).ok).toBe(true)
    // Re-affirming your own role is not a demotion.
    expect(checkRoleChange({ actorId: 1, targetId: 1, makeAdmin: true }).ok).toBe(true)
  })
})
