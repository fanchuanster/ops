import {
  type ExtractedMetadata,
  fromAppXml,
  fromCoreXml,
  fromFilename,
  fromPdfText,
  fromPlainText,
  bytesToBinaryString,
  mergeMetadata,
  pdfPageCount,
} from '../domain/metadata'
import { estimatePages } from '../domain/uploadQuota'
import { logError } from './logError'
import { objectRange } from './storage'

const PDF_SCAN_BYTES = 512 * 1024

const MAX_ZIP_ENTRY = 1024 * 1024

const TEXT_SAMPLE = 4 * 1024 * 1024

export interface ByteSource {
  name: string
  type: string
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export function fileSource(file: File): ByteSource {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    async read(start, end) {
      return new Uint8Array(await file.slice(start, end).arrayBuffer())
    },
  }
}

export function r2Source(
  storageKey: string,
  meta: { name: string; type: string; size: number },
): ByteSource {
  return {
    ...meta,
    async read(start, end) {
      const bytes = await objectRange(storageKey, start, Math.max(0, end - start))
      return bytes ?? new Uint8Array(0)
    },
  }
}

export interface Extraction extends ExtractedMetadata {
  estimatedPages: number | null
}

export async function extractMetadata(file: ByteSource): Promise<Extraction> {
  const byFilename = fromFilename(file.name)
  let found: ExtractedMetadata = {}

  try {
    const type = file.type
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const [core, app] = await Promise.all([
        readZipEntry(file, 'docProps/core.xml'),
        readZipEntry(file, 'docProps/app.xml'),
      ])
      found = mergeMetadata(core ? fromCoreXml(core) : {}, app ? fromAppXml(app) : {})
    } else if (type === 'application/pdf') {
      const raw = await readPdfEnds(file)
      found = mergeMetadata(fromPdfText(raw), { pageCount: pdfPageCount(raw) })
    } else if (type.startsWith('text/')) {
      const text = new TextDecoder().decode(await file.read(0, TEXT_SAMPLE))
      const ratio = file.size > TEXT_SAMPLE ? file.size / TEXT_SAMPLE : 1
      found = mergeMetadata(fromPlainText(text), {
        characters: Math.round(text.length * ratio),
      })
    }
  } catch (error) {
    logError('extractMetadata: read file', error)
  }

  const metadata = mergeMetadata(byFilename, found)
  return {
    ...metadata,
    estimatedPages: estimatePages({
      pdfPageCount: metadata.pageCount ?? null,
      characters: metadata.characters ?? null,
    }),
  }
}

async function readPdfEnds(file: ByteSource): Promise<string> {
  if (file.size <= PDF_SCAN_BYTES * 2) {
    return bytesToBinaryString(await file.read(0, file.size))
  }

  const [head, tail] = await Promise.all([
    file.read(0, PDF_SCAN_BYTES),
    file.read(file.size - PDF_SCAN_BYTES, file.size),
  ])
  return bytesToBinaryString(head) + bytesToBinaryString(tail)
}

async function readZipEntry(file: ByteSource, name: string): Promise<string | null> {
  const window = await file.read(0, Math.min(file.size, 256 * 1024))
  const wanted = new TextEncoder().encode(name)

  const at = indexOfSequence(window, wanted)
  if (at < 0) return null

  const header = at - 30
  if (header < 0) return null
  const view = new DataView(window.buffer, window.byteOffset, window.byteLength)
  if (view.getUint32(header, true) !== 0x04034b50) return null

  const method = view.getUint16(header + 8, true)
  const compressed = view.getUint32(header + 18, true)
  const nameLength = view.getUint16(header + 26, true)
  const extraLength = view.getUint16(header + 28, true)
  const start = header + 30 + nameLength + extraLength

  if (compressed === 0 || compressed > MAX_ZIP_ENTRY) return null
  if (start + compressed > window.byteLength) return null

  const body = window.slice(start, start + compressed)

  if (method === 0) return new TextDecoder().decode(body)
  if (method !== 8) return null

  const inflated = new Response(
    new Blob([body as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
  )
  return await inflated.text()
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
