export type EmailProblem = 'empty' | 'malformed'

export type EmailCheck =
  | { valid: true; email: string }
  | { valid: false; problem: EmailProblem }

export function checkAccountEmail(input: string): EmailCheck {
  const email = input.trim().toLowerCase()
  if (email === '') return { valid: false, problem: 'empty' }
  if (/\s/.test(email)) return { valid: false, problem: 'malformed' }

  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return { valid: false, problem: 'malformed' }

  const domain = email.slice(at + 1)
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return { valid: false, problem: 'malformed' }
  }

  return { valid: true, email }
}

export type RoleChangeRefusal = 'self_demotion'

export type RoleChangeCheck = { ok: true } | { ok: false; refusal: RoleChangeRefusal }

export function checkRoleChange({
  actorId,
  targetId,
  makeAdmin,
}: {
  actorId: number
  targetId: number
  makeAdmin: boolean
}): RoleChangeCheck {
  if (actorId === targetId && !makeAdmin) return { ok: false, refusal: 'self_demotion' }
  return { ok: true }
}
