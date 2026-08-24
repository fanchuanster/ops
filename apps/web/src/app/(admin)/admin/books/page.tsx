import { redirect } from 'next/navigation'

/**
 * Books and Collections became one screen on 2026-08-24.
 *
 * Kept as a redirect rather than deleted: this was a bookmarkable admin
 * URL for weeks, and `/admin/books?book=12` in particular was how a
 * decision got shared. The book parameter survives the move because the
 * merged screen reads the same one.
 */
export const dynamic = 'force-dynamic'

export default async function MovedBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; book?: string }>
}) {
  const params = await searchParams
  const next = new URLSearchParams()
  if (params.q) next.set('q', params.q)
  if (params.book) next.set('book', params.book)
  const search = next.toString()
  redirect(search ? `/admin/library?${search}` : '/admin/library')
}
