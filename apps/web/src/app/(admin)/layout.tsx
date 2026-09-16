import React from 'react'

import { AdminNav } from '../../components/admin/AdminNav'
import { BrandMark } from '../../components/BrandMark'
import { countAwaitingReview } from '../../lib/adminData'
import { requireAdmin } from '../../lib/adminAuth'
import '../(frontend)/styles.css'
import './admin.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: {
    default: 'Admin — NobleSee',
    template: '%s — NobleSee Admin',
  },
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  const awaiting = await countAwaitingReview()

  return (
    <html lang="en">
      <body className="admin-body">
        <div className="admin">
          <aside className="admin-side">
            <div className="admin-side__head">
              <a className="admin-side__back" href="/">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M9 2L4 7l5 5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Back to site
              </a>
              <div className="admin-side__mark">
                <BrandMark />
                <span>
                  <strong>NobleSee</strong>
                  <em>Admin</em>
                </span>
              </div>
            </div>

            <AdminNav awaiting={awaiting} />
          </aside>

          <main className="admin-main">{children}</main>
        </div>
      </body>
    </html>
  )
}
