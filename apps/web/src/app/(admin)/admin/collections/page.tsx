import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function MovedCollectionsPage() {
  redirect('/admin/library')
}
