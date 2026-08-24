import { revalidatePath } from 'next/cache'

/**
 * The pages a curation write changes for everybody else.
 *
 * The same set the admin's own server actions revalidate, in one place
 * because the API is a third writer of the same rows and a list that
 * drifted would leave a reader looking at a stale catalog after a
 * scripted change but not after a hand-made one.
 */
export async function revalidateCuration(): Promise<void> {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}
