import { permanentRedirect } from 'next/navigation'

export default function CollectionsPage(): never {
  permanentRedirect('/books')
}
