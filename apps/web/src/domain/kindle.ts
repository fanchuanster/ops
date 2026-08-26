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

/**
 * The address NobleSee sends from.
 *
 * A business fact rather than configuration: Amazon drops documents
 * from any sender not on the reader's Approved Personal Document
 * E-mail List, so this exact string is what a reader has to add in
 * their Amazon settings. The reminder shown in the UI and the From
 * header must be the same value or the advice is wrong — hence one
 * constant, not two strings that happen to match today.
 */
export const KINDLE_SENDER_ADDRESS = 'kindle@noblesee.com'

/**
 * Formats worth emailing to a Kindle.
 *
 * The DOCX master is deliberately absent, as it is everywhere a reader
 * can reach: it is the editorial source of truth, not a reader format.
 * EPUB is first because Amazon converts it to the native format and it
 * stays reflowable; the PDF is accepted but arrives fixed-layout, which
 * is the thing this project exists to move away from. It is also, for a
 * book published as it stands, the only thing there is to send.
 *
 * Plain text is deliverable too, and is the one place the ordering above
 * does not read as a ranking: Amazon has accepted `.txt` for as long as
 * it has accepted anything, and a text file on a Kindle reflows exactly
 * as an EPUB does. It arrives without chapters or a contents list, which
 * is what converting it would add — not without the reading experience.
 */
export const KINDLE_DELIVERABLE_FORMATS = ['epub', 'pdf', 'txt'] as const

export type KindleDeliverableFormat = (typeof KINDLE_DELIVERABLE_FORMATS)[number]

export function isKindleDeliverableFormat(format: string): format is KindleDeliverableFormat {
  return (KINDLE_DELIVERABLE_FORMATS as readonly string[]).includes(format)
}

export type KindleRefusal =
  | 'no_address'
  | 'format_not_deliverable'
  | 'too_large'
  | 'delivery_unavailable'

/**
 * Whether this reader can be sent this file, given only the facts the
 * domain is allowed to know.
 *
 * Deliberately does *not* decide rights, staged release or the download
 * limit — `authorizeDownload` already owns all three, and re-deciding
 * them here would create a second answer that could drift from the
 * first. This adds only what is specific to Kindle.
 */
export function checkKindleDelivery({
  kindleAddress,
  format,
  bytes,
  transportConfigured,
}: {
  kindleAddress: string | null | undefined
  format: string
  bytes?: number
  transportConfigured: boolean
}): { ok: true; address: string } | { ok: false; refusal: KindleRefusal } {
  if (!transportConfigured) return { ok: false, refusal: 'delivery_unavailable' }

  const address = checkKindleAddress(kindleAddress ?? '')
  if (!address.valid) return { ok: false, refusal: 'no_address' }

  if (!isKindleDeliverableFormat(format)) return { ok: false, refusal: 'format_not_deliverable' }

  if (typeof bytes === 'number' && !isEmailableSize(bytes)) {
    return { ok: false, refusal: 'too_large' }
  }

  return { ok: true, address: address.address }
}
