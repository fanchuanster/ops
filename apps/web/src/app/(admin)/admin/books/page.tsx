import { redirect } from 'next/navigation'

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
