import { permanentRedirect } from 'next/navigation'

/**
 * There is no collections page any more.
 *
 * A collection is not a thing beside a book — it is how books are
 * shelved, and the library already shows every collection as the shelf
 * it labels. A separate page listing collections as cards was a second
 * answer to a question `/books` already answers better, and it made a
 * reader choose between "browse the books" and "browse the shelves"
 * when those are the same act.
 *
 * Kept as a redirect rather than deleted outright: the footer linked
 * here for months, so the URL is in bookmarks and in history. Permanent
 * because the merge is not provisional.
 */
export default function CollectionsPage(): never {
  permanentRedirect('/books')
}
