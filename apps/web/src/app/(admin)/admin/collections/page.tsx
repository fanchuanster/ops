import { redirect } from 'next/navigation'

/** Books and Collections became one screen on 2026-08-24. */
export const dynamic = 'force-dynamic'

export default function MovedCollectionsPage() {
  redirect('/admin/library')
}
