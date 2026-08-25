import { revalidatePath } from 'next/cache'

/**
 * Every page that draws a book's face.
 *
 * A cover is the one property of a book that appears on pages the book
 * is not the subject of — the homepage's shelves, the catalog, the
 * collections page, the admin list — so changing it has to sweep wider
 * than the book's own route. Shared by both writers (an editor's
 * upload, and the choice of which page a book wears) so the two cannot
 * drift into revalidating different sets.
 *
 * The book's own page is only revalidated when the caller knows its
 * slug: the alternative is guessing at a path, which would silently
 * revalidate nothing.
 */
export function revalidateCover(slug: string) {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
  if (slug) revalidatePath(`/books/${slug}`)
}
