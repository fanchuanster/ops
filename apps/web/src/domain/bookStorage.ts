import type { ArtifactFormat } from './conversion'

const EXTENSION: Record<ArtifactFormat, string> = {
  docx: '.docx',
  epub: '.epub',
  pdf: '.pdf',
  txt: '.txt',
}

const PREFIX = 'books/'

export const FALLBACK_STEM = 'book'

const MAX_STEM = 80

export function stemFromFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename : ''
  const base = raw.split(/[/\\]/).pop() ?? ''
  const stripped = base.replace(/\.[A-Za-z0-9]{1,8}$/, '')

  const cleaned = stripped
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/["'`?#%&<>{}[\]^~|:*\\]/g, '')
    .replace(/\.+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_STEM)
    .replace(/^[-.]+|[-.]+$/g, '')

  return cleaned || FALLBACK_STEM
}

export function stemFromKey(key: string): string {
  const withoutPrefix = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
  const slash = withoutPrefix.lastIndexOf('/')
  const dot = withoutPrefix.lastIndexOf('.')
  return dot > slash && dot > 0 ? withoutPrefix.slice(0, dot) : withoutPrefix
}

export function bookStem({
  artifacts,
  sourceFilename,
  preferred,
}: {
  artifacts?: readonly { format?: string | null; storageKey?: string | null }[] | null
  sourceFilename?: unknown
  preferred?: ArtifactFormat | null
}): string {
  const filed = (artifacts ?? []).filter(
    (artifact): artifact is { format: string; storageKey: string } =>
      typeof artifact?.storageKey === 'string' && artifact.storageKey.length > 0,
  )

  const anchor =
    (preferred ? filed.find((artifact) => artifact.format === preferred) : undefined) ??
    filed.find((artifact) => artifact.format === 'docx') ??
    filed[0]

  return anchor ? stemFromKey(anchor.storageKey) : stemFromFilename(sourceFilename)
}

export function artifactKey(stem: string, format: ArtifactFormat): string {
  return `${PREFIX}${stem}${EXTENSION[format]}`
}

export function suggestionsKey(stem: string): string {
  return `${PREFIX}${stem}-suggestions.json`
}

export function decisionsKey(stem: string): string {
  return `${PREFIX}${stem}-decisions.json`
}

export function coverKey(stem: string, page: number = 1): string {
  return coverCandidateKey(`${PREFIX}${stem}-cover.jpg`, page)
}

export function coverCandidateKey(baseKey: string, page: number): string {
  return page <= 1 ? baseKey : numbered(baseKey, page - 1)
}

export function numbered(key: string, attempt: number): string {
  if (attempt <= 0) return key
  const slash = key.lastIndexOf('/')
  const dot = key.lastIndexOf('.')
  const tag = `-${attempt + 1}`
  return dot > slash && dot > 0
    ? `${key.slice(0, dot)}${tag}${key.slice(dot)}`
    : `${key}${tag}`
}

export function numberedStem(stem: string, attempt: number): string {
  return attempt <= 0 ? stem : `${stem}-${attempt + 1}`
}

export function stemFootprint(stem: string): string[] {
  return [
    artifactKey(stem, 'pdf'),
    artifactKey(stem, 'docx'),
    artifactKey(stem, 'epub'),
    artifactKey(stem, 'txt'),
    coverKey(stem),
    suggestionsKey(stem),
    decisionsKey(stem),
  ]
}
