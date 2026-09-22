import React from 'react'

export function ShareCta() {
  return (
    <div className="share-cta">
      <a href="/account/upload">
        Share your book of the year
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12h13m0 0-5-5m5 5-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  )
}
