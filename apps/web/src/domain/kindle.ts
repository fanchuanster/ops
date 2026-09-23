export const KINDLE_DOMAINS = ['kindle.com', 'free.kindle.com'] as const

export type KindleAddressProblem =
  | 'empty'
  | 'malformed'
  | 'wrong_domain'

export type KindleAddressCheck =
  | { valid: true; address: string }
  | { valid: false; problem: KindleAddressProblem }

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

export const RESEND_MAX_ENCODED_BYTES = 40_000_000

export const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024

export const ENVELOPE_ALLOWANCE_BYTES = 4096

export function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

export function isEmailableSize(bytes: number): boolean {
  if (bytes <= 0) return false
  if (bytes > MAX_ATTACHMENT_BYTES) return false
  return encodedSize(bytes) + ENVELOPE_ALLOWANCE_BYTES <= RESEND_MAX_ENCODED_BYTES
}

export function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function tooLargeMessage(bytes: number): string {
  return (
    `Could not send it: this edition is ${describeBytes(bytes)}, and email can ` +
    `carry at most ${describeBytes(MAX_ATTACHMENT_BYTES)}.`
  )
}

export const KINDLE_SENDER_ADDRESS = 'kindle@noblesee.com'

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

export const KINDLE_CONVERT_SUBJECT = 'Convert'

export function kindleSubject({
  filename,
  convert,
}: {
  filename: string
  convert?: boolean
}): string {
  return convert ? KINDLE_CONVERT_SUBJECT : filename
}
