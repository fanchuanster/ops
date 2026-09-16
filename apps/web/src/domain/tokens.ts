export const TOKEN_PREFIX = 'nbl_pat_'

const TOKEN_BYTES = 24

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${TOKEN_PREFIX}${hex}`
}

export function maskToken(token: string): string {
  const body = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token
  const head = token.startsWith(TOKEN_PREFIX) ? TOKEN_PREFIX : ''

  if (body.length < 12) return `${head}${'•'.repeat(Math.max(body.length, 4))}`
  return `${head}${body.slice(0, 4)}…${body.slice(-4)}`
}
