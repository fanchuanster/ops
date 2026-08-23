import React from 'react'

/**
 * The NobleSee mark: the phoenix rising from an open book.
 *
 * Cut from `res/noblesee-icon.png` — the emblem only, without the
 * "NOBLESEE" lettering and tagline that the full badge carries. The
 * lettering is set beside it in the site's own display face instead,
 * because baked-in type at an 18px mark is unreadable and would fight
 * the wordmark next to it.
 *
 * A raster rather than the inline paths that stood here before: this is
 * a painted emblem with feathering and two golds, not two rectangles.
 * It is 86px wide for an 18px slot, so it stays sharp at 2x and above,
 * and it is small enough that one cached request costs nothing.
 *
 * `decoding="async"` and no lazy flag on purpose — it sits in the
 * header of every page, so it should never be deferred, but it must
 * also never hold up first paint.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      decoding="async"
      className="brand-mark"
    />
  )
}
