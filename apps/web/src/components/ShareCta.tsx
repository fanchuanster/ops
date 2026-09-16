import React from 'react'

export function ShareCta() {
  return (
    <div className="invite">
      <div>
        <p className="eyebrow">Grow the library</p>
        <p className="invite__title">Know a book that belongs here?</p>
      </div>
      <a className="cta" href="/account/upload">
        Share your book of the year →
      </a>
    </div>
  )
}
