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
 * Resend's ceiling: 40 MB per email, measured *after* base64 encoding.
 *
 * Read as decimal rather than 40 MiB, deliberately. Their documentation
 * says "40MB" without saying which, and being 4% under a limit costs a
 * megabyte of book where being 4% over costs every send of a large one.
 *
 * Not ours to raise. It is the outermost constraint that still binds:
 * Amazon accepts 50 MB per personal document, so a larger book needs a
 * different provider, not a different constant.
 */
export const RESEND_MAX_ENCODED_BYTES = 40_000_000

/**
 * How large a book may be and still reach a Kindle by email.
 *
 * **Base64 is email's, not Resend's.** An attachment travels as MIME
 * and a MIME body must be 7-bit safe, so the 4/3 inflation applies to
 * any provider and any protocol that could carry this. There is no
 * "send it raw" available at any price; 30 MB of book is 40 MB on the
 * wire wherever it goes.
 *
 * What that leaves is Resend's 40 MB, and this is now set from it —
 * `28 MiB` encodes to 39.1 MB, inside the cap with room for the JSON
 * envelope around it. The test in `domain.test.ts` asserts that
 * relationship rather than trusting the arithmetic to stay true.
 *
 * The Worker used to be the tighter constraint and no longer is. The
 * transport built the whole encoded book as a string, embedded it in an
 * object, stringified that and let `fetch` serialise the result — four
 * full-length copies against 128 MB of memory. It now writes one
 * exactly-sized buffer (`lib/kindle/transport.ts`), so the peak is the
 * book plus its encoded form: about 65 MB at this limit, which is
 * headroom rather than a ceiling.
 *
 * The number is **raw bytes** — the size of the file the reader
 * actually has. Encoding inflation is derived below rather than being
 * charged invisibly against a constant that looks like a file size.
 *
 * It was 18 MB applied to the *encoded* size until 2026-08-27, which
 * refused every book over 13.5 MB, and justified itself with a 25 MB
 * limit on "most SMTP relays". Workers cannot open a mail socket at
 * all; delivery has always gone over Resend's HTTP API, so that
 * constraint never applied to a single send this system has made.
 */
export const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024

/**
 * Room for the JSON around the attachment — sender, recipient, subject,
 * filename, and the short message body. A few hundred bytes in
 * practice; 4 KB so a long CJK title escaped character by character
 * cannot eat the margin.
 */
export const ENVELOPE_ALLOWANCE_BYTES = 4096

/** What `n` raw bytes become once base64 encoded. */
export function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

export function isEmailableSize(bytes: number): boolean {
  if (bytes <= 0) return false
  if (bytes > MAX_ATTACHMENT_BYTES) return false
  return encodedSize(bytes) + ENVELOPE_ALLOWANCE_BYTES <= RESEND_MAX_ENCODED_BYTES
}

/** Megabytes, one decimal place, for telling a reader what went wrong. */
export function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Why a book cannot be emailed, said once.
 *
 * **Both numbers, always: this file against the limit.** "Too large"
 * alone leaves a reader with nothing to act on, the limit alone does not
 * say by how much, and the file's own size alone does not say what it is
 * being measured against. The pair is the only version that explains
 * itself.
 *
 * It lives here rather than in either caller because a reader can meet
 * this refusal twice — greyed out in the format list before the click,
 * and from the server after it, if the size was never recorded on the
 * artifact. Two hand-written versions would drift, and the reader who
 * saw both would be left reconciling them.
 *
 * It ends at the reader rather than at a download. There is no
 * download: a book is read here or sent to a device, which is a product
 * decision rather than a missing feature (CLAUDE.md section 1).
 */
export function tooLargeMessage(bytes: number): string {
  return (
    `This edition is ${describeBytes(bytes)}. Email can carry ` +
    `${describeBytes(MAX_ATTACHMENT_BYTES)}, so it cannot be sent to a Kindle. ` +
    `Read it here instead — the online reader has the whole book.`
  )
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
