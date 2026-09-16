import { revalidatePath } from 'next/cache'

export function revalidateCover(slug: string) {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
  if (slug) revalidatePath(`/books/${slug}`)
}
