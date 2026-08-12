import React from 'react'

import { ThemeToggle } from '../../components/ThemeToggle'
import './styles.css'

export const metadata = {
  title: {
    default: 'NobleSee — books worth reading, made comfortable to read',
    template: '%s — NobleSee',
  },
  description:
    'Digital preservation of traditional Chinese classics, history and works of wisdom, rebuilt as clean reflowable editions for modern devices and e-readers.',
}

/**
 * Applied before first paint, so a reader who chose dark never sees a
 * white flash. It is inline and synchronous for exactly that reason —
 * anything deferred runs after the browser has already painted.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('noblesee-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <a className="wordmark" href="/">
              Noble<span>See</span>
            </a>
            <nav className="site-nav">
              <a href="/books">Library</a>
              <a href="/collections">Collections</a>
              <a href="/about">About</a>
              <ThemeToggle />
            </nav>
          </div>
        </header>

        {children}

        <footer className="site-footer">
          <div className="page">
            <p>
              NobleSee preserves valuable books — traditional Chinese classics, history and works
              of wisdom — as clean, reflowable editions that are genuinely pleasant to read.
            </p>
            <p>
              Every book in the public library is published under a cleared rights status. Texts
              are proofread against an authoritative source before release.
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
