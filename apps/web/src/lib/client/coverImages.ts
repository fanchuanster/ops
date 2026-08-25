/**
 * The opening pages of a book, rendered in the reader's own browser.
 *
 * Covers used to be job kind three on the converter — a Python service
 * with PyMuPDF, claimed off the same poll as OCR and format generation.
 * That coupling was an accident of where the renderer happened to be
 * written, and it cost the library every cover it had: a converter
 * claimed each book, never reported back, and `claimCover` only ever
 * offers `pending`, so fourteen books sat with no cover and nothing
 * retrying them. Making a picture of page one has nothing to do with
 * converting a book.
 *
 * So it happens here instead, on the machine that already has the file
 * open. The uploader's browser renders the candidates before the upload
 * even leaves the page; an editor's browser renders them for a book
 * already in the library. Neither costs the Worker anything — this
 * module never runs on the server — and a book has a cover before its
 * conversion is so much as queued.
 *
 * Two sources, because they are two different problems:
 *
 *   PDF    rasterize the first pages. Real work, and the reason this
 *          cannot live in the Worker: pdf.js is a megabyte of
 *          JavaScript against a bundle already at 7.7 MB of a 10 MB
 *          limit, and rasterizing is CPU a Worker is billed for.
 *   EPUB   no rasterizing at all. The cover is a file inside the zip
 *          and the manifest says which one; epub.js is already here for
 *          the reader.
 *
 * Both are imported dynamically, so a reader who never uploads anything
 * downloads neither.
 */

import {
  COVER_CANDIDATE_PAGES,
  COVER_IMAGE_MAX_HEIGHT,
  COVER_IMAGE_MAX_WIDTH,
  COVER_JPEG_QUALITY,
} from '../../domain/cover'

/** What a source can be asked for candidates. */
export type CoverSource = 'pdf' | 'epub'

export function coverSourceFor(fileName: string, type: string): CoverSource | null {
  const name = fileName.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (type === 'application/epub+zip' || name.endsWith('.epub')) return 'epub'
  return null
}

/**
 * The candidates for a file, in page order, or an empty list.
 *
 * Never throws. A cover is cosmetic — the tile falls back to the book's
 * own first character — so a PDF this browser cannot parse must not be
 * able to fail an upload that otherwise succeeded.
 */
export async function coverImagesFor(
  file: Blob,
  source: CoverSource,
  pages: number = COVER_CANDIDATE_PAGES,
): Promise<Blob[]> {
  try {
    return source === 'pdf' ? await fromPdf(file, pages) : await fromEpub(file)
  } catch {
    return []
  }
}

async function fromPdf(file: Blob, pages: number): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist')

  // pdf.js does its parsing in a worker by default and needs to be told
  // where that worker is. The URL is resolved by the bundler, so the
  // file is emitted as an asset rather than fetched from a CDN — which
  // the artifact CSP would refuse anyway. If it cannot be set up,
  // pdf.js falls back to parsing on this thread, which is slower and
  // still correct.
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  } catch {
    // Left to the fake worker.
  }

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise

  try {
    const images: Blob[] = []
    // Only the pages that exist: a two-page book has two candidates.
    for (let number = 1; number <= Math.min(pages, pdf.numPages); number += 1) {
      const page = await pdf.getPage(number)

      // Scaled to land on the cover box rather than rendered at a fixed
      // resolution: page sizes here run from a paperback scan to A4, and
      // a fixed scale makes the first cost four times the bytes of the
      // second for the same displayed size.
      const unscaled = page.getViewport({ scale: 1 })
      const scale = Math.min(
        COVER_IMAGE_MAX_WIDTH / (unscaled.width || 1),
        COVER_IMAGE_MAX_HEIGHT / (unscaled.height || 1),
      )
      const viewport = page.getViewport({ scale })

      const canvas = blankCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      if (!context) break

      // White first. A page with no background of its own composites
      // onto transparency, and transparency encodes to black in a JPEG.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvas, canvasContext: context, viewport }).promise
      const image = await toJpeg(canvas)
      if (!image) break
      images.push(image)
    }
    return images
  } finally {
    // Frees the worker; without it a page that uploads several books
    // accumulates one per file.
    await pdf.destroy()
  }
}

/**
 * The cover image an EPUB declares, if it declares one.
 *
 * One candidate at most, and no choice to offer: an EPUB has no pages
 * to rasterize, only the picture its manifest names.
 */
async function fromEpub(file: Blob): Promise<Blob[]> {
  const { default: ePub } = await import('epubjs')
  const book = ePub(await file.arrayBuffer())

  try {
    const url = await book.coverUrl()
    if (!url) return []

    // A blob: URL into the archive epub.js already parsed, so this
    // fetch never leaves the browser.
    const response = await fetch(url)
    const blob = await response.blob()
    return blob.size > 0 ? [blob] : []
  } finally {
    book.destroy()
  }
}

/** A detached canvas of the given size. */
function blankCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  return canvas
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', COVER_JPEG_QUALITY)
  })
}

/**
 * Render a file's candidates and post them, in one call.
 *
 * Answers whether anything was stored, and never throws for the same
 * reason `coverImagesFor` does not: this runs beside an upload that has
 * already succeeded, and a cover is not worth failing it over.
 */
export async function makeCoversFor(
  bookId: number | string,
  file: Blob,
  source: CoverSource,
): Promise<boolean> {
  const images = await coverImagesFor(file, source)
  if (images.length === 0) return false

  const body = new FormData()
  for (const image of images) body.append('pages', image, 'page.jpg')

  try {
    const response = await fetch(`/covers/${bookId}`, { method: 'POST', body })
    return response.ok
  } catch {
    return false
  }
}
