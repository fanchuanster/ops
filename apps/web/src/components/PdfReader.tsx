import React from 'react'

export function PdfReader({
  url,
  bookTitle,
  subtitle,
}: {
  url: string
  bookTitle: string
  subtitle: string
}) {
  const src = `${url}#view=FitH`

  return (
    <div className="reader">
      <div className="reader__bar">
        <div className="reader__where">
          <strong>{bookTitle}</strong>
          <span>{subtitle}</span>
        </div>
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
