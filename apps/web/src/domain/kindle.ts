/**
 * Rules for Kindle delivery addresses.
 *
 * Framework-independent, like the rest of `src/domain`. The validation
 * matters more than it looks: Amazon silently discards documents sent
 * to an address it does not recognise, so a typo here becomes "I
 * pressed the button and nothing arrived" with no error anywhere. It is
 * cheaper to refuse the address than to debug the silence.
 */

/**
 * Domains Amazon accepts for personal document delivery.
 *
 * `free.kindle.com` delivers only over Wi-Fi rather than cellular; it is
 * a legitimate choice, not a mistake, so it is accepted too.
 */
export const KINDLE_DOMAINS = ['kindle.com', 'free.kindle.com'] as const

export type KindleAddressProblem =
  | 'empty'
  | 'malformed'
  | 'wrong_domain'

export type KindleAddressCheck =
  | { valid: true; address: string }
  | { valid: false; problem: KindleAddressProblem }

/**
 * Validates and normalises a Kindle delivery address.
 *
 * Normalisation is lowercase-and-trim only. The local part is left
 * otherwise untouched: Amazon assigns it, and "helpfully" stripping
 * dots or plus-tags the way one might for Gmail would break real
 * addresses.
 */
export function checkKindleAddress(input: string): KindleAddressCheck {
  const address = input.trim().toLowerCase()
  if (!address) return { valid: false, problem: 'empty' }

  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return { valid: false, problem: 'malformed' }

  const local = address.slice(0, at)
  const domain = address.slice(at + 1)

  if (/\s/.test(address)) return { valid: false, problem: 'malformed' }
  if (!local) return { valid: false, problem: 'malformed' }

  if (!KINDLE_DOMAINS.includes(domain as (typeof KINDLE_DOMAINS)[number])) {
    return { valid: false, problem: 'wrong_domain' }
  }

  return { valid: true, address }
}

/**
 * Whether a file is small enough to email.
 *
 * Amazon accepts documents up to 50 MB, but the mail path in between is
 * the tighter constraint — most SMTP relays reject messages over 25 MB,
 * and base64 encoding inflates an attachment by roughly a third. The
 * limit is applied to the *encoded* size for that reason.
 */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024

export function isEmailableSize(bytes: number): boolean {
  return bytes > 0 && Math.ceil(bytes / 3) * 4 <= MAX_ATTACHMENT_BYTES
}
