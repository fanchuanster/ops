import React from 'react'

import { AccountLink } from '../../components/AccountLink'
import { BrandMark } from '../../components/BrandMark'
import { GoogleOneTap } from '../../components/GoogleOneTap'
import { SiteNav } from '../../components/SiteNav'
import { getCurrentUser } from '../../lib/auth'
import { isGoogleSignInConfigured } from '../../lib/googleOAuth'
import './styles.css'

// The header reflects who is signed in, so the shell is per-request.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: {
    default: 'NobleSee — books worth reading, made comfortable to read',
    template: '%s — NobleSee',
  },
  description:
    'Digital preservation of traditional Chinese classics, history and works of wisdom, rebuilt as clean reflowable editions for modern devices and e-readers.',
}

export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <a className="wordmark" href="/">
              <BrandMark />
              Noble<span>See</span>
            </a>
            <SiteNav>
              {user ? (
                <AccountLink
                  identity={{
                    email: user.email,
                    displayName: user.displayName,
                    avatarUrl: user.avatarUrl,
                  }}
                />
              ) : (
                <a className="site-nav__signin" href="/login">
                  Sign in
                </a>
              )}
            </SiteNav>
          </div>
        </header>

        {/* Only for a signed-out reader, and only when Google is set up.
            Rendering it otherwise would prompt someone who already has a
            session, or load Google's script for nothing. */}
        {!user && isGoogleSignInConfigured() ? <GoogleOneTap /> : null}

        {children}

        <footer className="site-footer">
          <div className="page">
            <div className="site-footer__bar">
              <a className="wordmark" href="/">
                <BrandMark />
                Noble<span>See</span>
              </a>
              {/* The design's footer carries the editorial promise
                  rather than a second navigation. */}
              <p className="site-footer__note">
                Reviewed by an editor before joining the public library.
              </p>
              <p style={{ margin: 0 }}>© {new Date().getFullYear()} NobleSee</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
