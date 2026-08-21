import React from 'react'

/**
 * The reader for a book that has no EPUB, and never will.
 *
 * A book published as it stands (`domain/publication.ts`) is a fixed
 * picture of its original: no reflow, no type size, none of the knobs
 * the EPUB reader exists to offer. Pretending otherwise would mean
 * parsing the PDF into something reflowable in the browser, which is
 * the conversion pipeline's job and is not free — its owner declined it
 * deliberately, and can still change their mind later.
 *
 * So this hands the pages to the browser's own PDF viewer and gets out
 * of the way. That viewer is a mature component we did not write
 * (CLAUDE.md section 2.2), it handles page navigation, zoom and search,
 * and it costs no bundle at all — this component ships no JavaScript.
 *
 * The stream is the same authorized route the EPUB comes down, so the
 * bucket stays private and the rights check still stands in front of
 * every page.
 */
export function PdfReader({
  url,
  bookTitle,
  subtitle,
}: {
  url: string
  bookTitle: string
  subtitle: string
}) {
  // `FitH` asks the viewer to fit the page width, which is the
  // difference between a readable page and a postage stamp on a phone.
  // Viewers that do not understand the fragment ignore it.
  const src = `${url}#view=FitH`

  return (
    <div className="reader">
      <div className="reader__bar">
        <div className="reader__where">
          <strong>{bookTitle}</strong>
          <span>{subtitle}</span>
        </div>
        {/* An escape hatch that is always there rather than only in the
            fallback below: a mobile browser will often render *some*
            frame for a PDF and then refuse to scroll it, which the
            fallback content never gets to answer. */}
        <a className="reader__aside" href={src} target="_blank" rel="noreferrer">
          Open full page ↗
        </a>
      </div>

      <div className="reader__stage">
        <object
          className="reader__pdf"
          data={src}
          type="application/pdf"
          aria-label={`${bookTitle}, original pages`}
        >
          <div className="reader__error">
            <p>This browser will not show the pages here.</p>
            <p className="hint">
              <a href={src} target="_blank" rel="noreferrer">
                Open them in a new tab
              </a>{' '}
              instead, or send the book to your e-reader from the book page.
            </p>
          </div>
        </object>
      </div>
    </div>
  )
}
