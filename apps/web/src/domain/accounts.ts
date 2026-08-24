/**
 * Rules for changing somebody else's account.
 *
 * Two things an administrator legitimately does to a reader — correct a
 * mistyped email, and grant or withdraw the admin role — and both are
 * sharper than they look. An email is a login identity, so changing it
 * decides who can get in. A role is the whole access model.
 *
 * Framework-independent, like everything in `src/domain`. What is *not*
 * here is who may perform either act: that is `requireAdmin` at the
 * screen and the `roles` field access on the collection. These are the
 * rules that hold once someone is entitled to act at all.
 */

export type EmailProblem = 'empty' | 'malformed'

export type EmailCheck =
  | { valid: true; email: string }
  | { valid: false; problem: EmailProblem }

/**
 * Validates and normalises an account email.
 *
 * Deliberately loose. Anything stricter than "a local part, an @, and a
 * domain with a dot in it" starts refusing addresses that genuinely
 * work — the real grammar allows quoted local parts, plus-tags and
 * apostrophes, and every homegrown tightening of it eventually rejects
 * a real reader. The address is not being trusted here, only stored;
 * whether it *receives* mail is answered by mail arriving.
 *
 * Lowercased, because an email a reader signs in with must not depend
 * on which case an administrator happened to type it in.
 */
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

/**
 * May this administrator make this change to this account's role?
 *
 * One rule, and it is about the actor rather than the target: **nobody
 * withdraws their own admin role.**
 *
 * It is the rule that keeps the library reachable. Since only an
 * administrator can grant the role, an installation that loses its last
 * one has no way back in through a browser at all — the "create first
 * user" screen is gone the moment any reader registers, and what
 * remains is `npm run create-admin` on somebody's laptop with
 * production credentials. Refusing self-demotion means at least one
 * administrator always exists: the one doing the demoting.
 *
 * Stated as "your own", not "the last one", on purpose. Counting
 * administrators would make the refusal depend on a query whose answer
 * changes between the check and the write, and would let two of the
 * last three demote each other simultaneously. This rule needs nothing
 * but the two ids.
 */
export function checkRoleChange({
  actorId,
  targetId,
  makeAdmin,
}: {
  actorId: number
  targetId: number
  /** The role being set, not the change: true means "should be an admin". */
  makeAdmin: boolean
}): RoleChangeCheck {
  if (actorId === targetId && !makeAdmin) return { ok: false, refusal: 'self_demotion' }
  return { ok: true }
}
