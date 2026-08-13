/**
 * Password policy.
 *
 * Framework-independent by rule, like the rest of `src/domain`: Payload
 * hooks and route handlers call into this module, never the reverse.
 *
 * This exists as a domain rule rather than a field option because
 * Payload gives no way to configure it. `generatePasswordSaltHash`
 * invokes the password validator with a fixed argument list and never
 * forwards `minLength` from the collection, so the built-in floor is
 * always 3 characters no matter what the config says. Anything stricter
 * has to be enforced by a hook, and the hook should not be where the
 * rule is written down.
 */

/**
 * Minimum accepted password length, for readers and administrators
 * alike.
 *
 * Deliberately permissive: NobleSee is a library, and a reader locked
 * out by a password rule is a reader who stops reading. The protections
 * that actually matter here are elsewhere — rights checks, download
 * authorization and staged release are all enforced server-side and
 * none of them depend on password strength.
 */
export const MIN_PASSWORD_LENGTH = 6

export interface PasswordProblem {
  message: string
}

/**
 * Returns a problem describing why the password is unacceptable, or
 * null if it passes.
 *
 * Returning a value rather than throwing keeps this usable from a form
 * action, which wants to render the message, and from a Payload hook,
 * which wants to raise it — neither has to catch to find out.
 */
export function checkPassword(password: unknown): PasswordProblem | null {
  if (typeof password !== 'string' || password.length === 0) {
    return { message: 'Enter a password.' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { message: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  return null
}
