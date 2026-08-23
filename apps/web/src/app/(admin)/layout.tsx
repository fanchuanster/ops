import React from 'react'

import { AdminNav } from '../../components/admin/AdminNav'
import { BrandMark } from '../../components/BrandMark'
import { countAwaitingReview } from '../../lib/adminData'
import { requireAdmin } from '../../lib/adminAuth'
import '../(frontend)/styles.css'
import './admin.css'

/**
 * The editorial admin's own shell.
 *
 * Its own root layout, and therefore deliberately *not* the site
 * header, footer and reading-first body type that `(frontend)` puts
 * around every reader-facing page. This is a working surface: a fixed
 * sidebar, a full-height scrolling pane, and sans-serif throughout. A
 * reader's page is a page; this is a desk.
 *
 * It still imports the site's own stylesheet first, because that is
 * where the palette lives. The admin is a different room in the same
 * building — the same brown, the same paper, the same rules — and a
 * second set of colours defined here would drift from the site within
 * a month. `admin.css` overrides only what a desk needs differently.
 *
 * The guard is here so that no admin page can forget it. It is not the
 * only guard: every server action checks again on its own, because a
 * layout never runs for a POST.
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: {
    default: 'Admin — NobleSee',
    template: '%s — NobleSee Admin',
  },
  // Nothing here should ever be indexed, including by whatever crawls
  // an authenticated page by accident.
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
                {/* The same mark the site header carries, at the
                    size the design sets it here. */}
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
