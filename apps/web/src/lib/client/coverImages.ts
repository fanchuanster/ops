import {
  COVER_CANDIDATE_PAGES,
  COVER_IMAGE_MAX_HEIGHT,
  COVER_IMAGE_MAX_WIDTH,
  COVER_JPEG_QUALITY,
} from '../../domain/cover'

export type CoverSource = 'pdf' | 'epub'

export function coverSourceFor(fileName: string, type: string): CoverSource | null {
  const name = fileName.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (type === 'application/epub+zip' || name.endsWith('.epub')) return 'epub'
  return null
}

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

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  } catch {
  }

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise

  try {
    const images: Blob[] = []
    for (let number = 1; number <= Math.min(pages, pdf.numPages); number += 1) {
      const page = await pdf.getPage(number)

      const unscaled = page.getViewport({ scale: 1 })
      const scale = Math.min(
        COVER_IMAGE_MAX_WIDTH / (unscaled.width || 1),
        COVER_IMAGE_MAX_HEIGHT / (unscaled.height || 1),
      )
      const viewport = page.getViewport({ scale })

      const canvas = blankCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      if (!context) break

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvas, canvasContext: context, viewport }).promise
      const image = await toJpeg(canvas)
      if (!image) break
      images.push(image)
    }
    return images
  } finally {
    await pdf.destroy()
  }
}

async function fromEpub(file: Blob): Promise<Blob[]> {
  const { default: ePub } = await import('epubjs')
  const book = ePub(await file.arrayBuffer())

  try {
    const url = await book.coverUrl()
    if (!url) return []

    const response = await fetch(url)
    const blob = await response.blob()
    return blob.size > 0 ? [blob] : []
  } finally {
    book.destroy()
  }
}

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
