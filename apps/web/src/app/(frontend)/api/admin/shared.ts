import { revalidatePath } from 'next/cache'

export async function revalidateCuration(): Promise<void> {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}
