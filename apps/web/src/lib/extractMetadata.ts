/**
 * Getting a file's own metadata out of it, at upload time.
 *
 * The parsing rules live in `domain/metadata.ts`; this module does the
 * part they refuse to do — unzip a DOCX, decode bytes, decide how much
 * of a large PDF is worth looking at.
 *
 * It runs on the Worker, during the upload request, which sets the
 * budget. A Worker is billed on CPU time, so nothing here parses a
 * whole book: the DOCX path inflates one small XML entry, and the PDF
 * path scans a bounded slice of the file. Anything more expensive
 * belongs in the converter, which has the CPU and already has the file.
 *
 * Never throws. Extraction is a convenience that fills a form; a file
 * we cannot read still uploads fine, the reader just types the title.
 */

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

/**
 * How much of a PDF to scan for metadata.
 *
 * The Info dictionary and the XMP packet live near one end or the
 * other, essentially never in the middle of the page content, so both
 * ends are read and the middle — which is the bulk of a scanned book —
 * is skipped entirely. 512 KB from each end reads a 200 MB scan as
 * cheaply as a one-page memo.
 */
const PDF_SCAN_BYTES = 512 * 1024

/** A DOCX entry bigger than this is not a properties file. */
const MAX_ZIP_ENTRY = 1024 * 1024

/** Text long enough to measure without reading a whole book into memory. */
const TEXT_SAMPLE = 4 * 1024 * 1024

export interface Extraction extends ExtractedMetadata {
  /**
   * What the quota is charged against, before anything is rendered.
   *
   * Null when the file says nothing about its own length — which the
   * quota treats as zero pages rather than a refusal, because the
   * upload count still catches it.
   */
  estimatedPages: number | null
}

export async function extractMetadata(file: File): Promise<Extraction> {
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
      const text = await file.slice(0, TEXT_SAMPLE).text()
      // Extrapolate when the file was longer than the sample, so a huge
      // text upload is not charged as a small one.
      const ratio = file.size > TEXT_SAMPLE ? file.size / TEXT_SAMPLE : 1
      found = mergeMetadata(fromPlainText(text), {
        characters: Math.round(text.length * ratio),
      })
    }
  } catch {
    // A corrupt zip, a truncated PDF, a decode failure. The filename is
    // still worth something and the reader can fix the rest.
  }

  const metadata = mergeMetadata(found, byFilename)
  return {
    ...metadata,
    estimatedPages: estimatePages({
      pdfPageCount: metadata.pageCount ?? null,
      characters: metadata.characters ?? null,
    }),
  }
}

/**
 * Both ends of a PDF, one code unit per byte.
 *
 * Not UTF-8 decoded: this is binary, and UTF-8 decoding replaces every
 * invalid sequence with U+FFFD, destroying the hex strings the parser
 * reads byte for byte. Not `TextDecoder('latin1')` either — that label
 * means windows-1252, which is lossy across 0x80–0x9F and cannot be
 * reversed, so any UTF-8 text in the file could never be repaired.
 * See `bytesToBinaryString`.
 */
async function readPdfEnds(file: File): Promise<string> {
  if (file.size <= PDF_SCAN_BYTES * 2) {
    return bytesToBinaryString(new Uint8Array(await file.arrayBuffer()))
  }

  const [head, tail] = await Promise.all([
    file.slice(0, PDF_SCAN_BYTES).arrayBuffer(),
    file.slice(file.size - PDF_SCAN_BYTES).arrayBuffer(),
  ])
  return (
    bytesToBinaryString(new Uint8Array(head)) + bytesToBinaryString(new Uint8Array(tail))
  )
}

/**
 * One named entry from a zip, without a zip library.
 *
 * A DOCX is a zip and `docProps/core.xml` is a few hundred bytes of it.
 * Pulling in a zip dependency to read that would add a parser for every
 * feature of the format — encryption, spanning, zip64 — none of which a
 * DOCX uses. Instead: find the entry's local header by name, then
 * inflate it with `DecompressionStream`, which the Workers runtime
 * provides natively.
 *
 * Returns null for anything unusual rather than trying harder. The
 * caller has a filename to fall back on.
 */
async function readZipEntry(file: File, name: string): Promise<string | null> {
  // Local headers sit at the front of the archive; core.xml is one of
  // the first entries Word writes. Reading a slice keeps a 60 MB DOCX
  // from being pulled into memory for a few hundred bytes.
  const window = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer())
  const wanted = new TextEncoder().encode(name)

  const at = indexOfSequence(window, wanted)
  if (at < 0) return null

  // The filename sits at offset 30 of a local file header, so the
  // header starts 30 bytes before the name — and the signature there
  // confirms it, rather than a coincidental match inside file data.
  const header = at - 30
  if (header < 0) return null
  const view = new DataView(window.buffer, window.byteOffset, window.byteLength)
  if (view.getUint32(header, true) !== 0x04034b50) return null

  const method = view.getUint16(header + 8, true)
  const compressed = view.getUint32(header + 18, true)
  const nameLength = view.getUint16(header + 26, true)
  const extraLength = view.getUint16(header + 28, true)
  const start = header + 30 + nameLength + extraLength

  // A streamed zip writes zero here and puts the real size in a
  // trailing data descriptor. Not worth chasing for a fallback path.
  if (compressed === 0 || compressed > MAX_ZIP_ENTRY) return null
  if (start + compressed > window.byteLength) return null

  const body = window.slice(start, start + compressed)

  // 0 = stored, 8 = deflate. Nothing else appears in a DOCX.
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
