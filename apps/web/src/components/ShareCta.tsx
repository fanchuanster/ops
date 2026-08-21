import React from 'react'

/**
 * The invitation to contribute, at the foot of the library and the
 * homepage alike.
 *
 * One component because the design uses one — the two pages showed
 * slightly different wording of the same offer until 2026-08-21, which
 * is the kind of drift a shared component exists to prevent.
 */
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
