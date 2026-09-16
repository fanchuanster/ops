export const MIN_PASSWORD_LENGTH = 6

export interface PasswordProblem {
  message: string
}

export function checkPassword(password: unknown): PasswordProblem | null {
  if (typeof password !== 'string' || password.length === 0) {
    return { message: 'Enter a password.' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { message: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  return null
}
