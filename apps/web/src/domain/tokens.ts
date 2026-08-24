/**
 * Personal access tokens: the shape of one, and how it is shown.
 *
 * A token lets a script act as its owner — the same credential Payload
 * calls an "API key" and resolves through its own auth strategy. This
 * module owns the two decisions that are ours rather than Payload's:
 * what the string looks like, and how much of it a page may print.
 *
 * Framework-independent, like the rest of `src/domain`. Web Crypto is a
 * global on Workers and on Node 18+, so generating a token needs no
 * import and no injected randomness.
 */

/**
 * The prefix every token we mint carries.
 *
 * Payload's own generator produces a bare UUID, which is
 * indistinguishable from any other UUID in a log, a paste, or a
 * commit. A fixed prefix makes a leaked token *recognisable* — by a
 * human skimming a stack trace, by a secret scanner, and by us when
 * someone opens an issue with one in the body. It costs eight
 * characters.
 */
export const TOKEN_PREFIX = 'nbl_pat_'

/**
 * 24 bytes, so 192 bits of entropy in 48 hex characters.
 *
 * Well past guessing, and deliberately not a UUID: a v4 UUID spends 6
 * of its bits on version and variant markers that say nothing here, and
 * reads as an identifier — something to be logged and correlated —
 * rather than as a secret.
 */
const TOKEN_BYTES = 24

/** A fresh token. Never stored anywhere but on its owner's account. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${TOKEN_PREFIX}${hex}`
}

/**
 * What a page prints when it is not printing the whole thing.
 *
 * Enough to tell two tokens apart — which is the only question a mask
 * has to answer, since a reader has at most one at a time and the real
 * use is "is the one in my script the one on this page". The prefix
 * stays intact because it is not secret and it is what makes the string
 * identifiable at a glance.
 *
 * Anything too short to mask meaningfully is returned as dots rather
 * than as itself. That case is not hypothetical: a token minted in the
 * CMS before this screen existed is a bare UUID, and a future one might
 * be anything at all.
 */
export function maskToken(token: string): string {
  const body = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token
  const head = token.startsWith(TOKEN_PREFIX) ? TOKEN_PREFIX : ''

  if (body.length < 12) return `${head}${'•'.repeat(Math.max(body.length, 4))}`
  return `${head}${body.slice(0, 4)}…${body.slice(-4)}`
}
