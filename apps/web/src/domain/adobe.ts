export type ExportLocale = 'zh-Hant' | 'zh-CN' | 'en-US'

export function exportLocaleFor(language: string | null | undefined): ExportLocale {
  switch (language) {
    case 'zh-Hans':
      return 'zh-CN'
    case 'en':
      return 'en-US'
    default:
      return 'zh-Hant'
  }
}

export const MAX_SOURCE_BYTES = 100 * 1024 * 1024

export function documentTransactions(pages: number): number {
  if (!Number.isFinite(pages) || pages <= 0) return 1
  return Math.ceil(pages / 50)
}

export function withinSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_SOURCE_BYTES
}

export type ExportState = 'running' | 'done' | 'failed'

export interface ExportOutcome {
  state: ExportState
  downloadUri?: string
  message?: string
  retryable?: boolean
}

export const MAX_EXPORT_RETRIES = 2

export function isTransientExportFailure(message: string | null | undefined): boolean {
  if (!message) return false
  const text = message.toLowerCase()
  return (
    /timed out|timeout/.test(text) ||
    /try (again|later|after)|please retry/.test(text) ||
    /too many requests|rate limit|throttl/.test(text) ||
    /temporarily unavailable|service unavailable|internal server error/.test(text)
  )
}

export function readExportStatus(body: unknown): ExportOutcome {
  if (typeof body !== 'object' || body === null) return { state: 'running' }
  const record = body as Record<string, unknown>
  const status = typeof record.status === 'string' ? record.status.toLowerCase() : ''

  if (status === 'failed') {
    const error = record.error
    const message =
      typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Adobe could not read this PDF.'
    return { state: 'failed', message, retryable: isTransientExportFailure(message) }
  }

  if (status === 'done') {
    const asset = record.asset
    const uri =
      typeof asset === 'object' && asset !== null && typeof (asset as { downloadUri?: unknown }).downloadUri === 'string'
        ? (asset as { downloadUri: string }).downloadUri
        : ''
    if (uri.length === 0) {
      return {
        state: 'failed',
        message: 'Adobe reported the export finished but returned no file.',
        retryable: false,
      }
    }
    return { state: 'done', downloadUri: uri }
  }

  return { state: 'running' }
}

export const EXPORT_TIMEOUT_MS = 6 * 60 * 60 * 1000

export function exportHasExpired(startedAt: string | null | undefined, now: number): boolean {
  if (!startedAt) return false
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return false
  return now - started > EXPORT_TIMEOUT_MS
}

export function needsExport(filename: string, mimeType?: string | null): boolean {
  if (mimeType === 'application/pdf') return true
  if (mimeType && mimeType !== 'application/octet-stream') return false
  return /\.pdf$/i.test(filename.trim())
}
