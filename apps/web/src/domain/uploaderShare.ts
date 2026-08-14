/**
 * What an uploader earns when someone takes their book away.
 *
 * A reader who digitises a book, proofreads the OCR and gets it into
 * the library has done the work NobleSee exists to do. When another
 * reader spends credits to send that book to a device, a share of what
 * they spent goes to the person who made it possible.
 *
 * The two rates reflect what was actually contributed:
 *
 *   - **A third** for a public-domain book. The text was already free;
 *     the uploader's contribution is the digitisation and the
 *     proofreading, which is real work and not authorship.
 *   - **Two thirds** for a book they wrote, or hold a licence to. Here
 *     they contributed the book itself.
 *
 * Nothing else earns. `user_owned` — "I have a copy" — never clears
 * public distribution, so nobody else can be sent that book in the
 * first place, and `unknown` and `restricted` are not distributable at
 * all. A library book entered by staff has no uploader to pay.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import type { RightsStatus } from './rights'

/** Percentages of what the reader spent. */
export const SHARE_PUBLIC_DOMAIN = 33
export const SHARE_LICENSED = 66

/**
 * Shares are accumulated in hundredths of a credit.
 *
 * This is the part that would otherwise quietly not work. Books cost 1
 * to 7 credits, and a third of one credit is 0.33 — so rounding each
 * payment to a whole credit pays **nothing at all** for every book
 * under four credits, which is most of them. An uploader would watch
 * their book be sent thirty times and earn zero.
 *
 * So each delivery earns whole *points*, they accumulate, and a credit
 * is paid out every time the total crosses a hundred. Nothing is lost
 * to rounding and nothing is invented: over many deliveries the
 * uploader receives exactly the percentage, and the remainder is
 * carried, not discarded.
 */
export const POINTS_PER_CREDIT = 100

export function sharePercent(rightsStatus: RightsStatus): number {
  switch (rightsStatus) {
    case 'public_domain':
      return SHARE_PUBLIC_DOMAIN
    case 'licensed':
    case 'permission_granted':
      return SHARE_LICENSED
    default:
      // user_owned, unknown, restricted: not publicly distributable, so
      // no one else can be sent the book and there is nothing to share.
      return 0
  }
}

/**
 * Points earned by the uploader for one delivery.
 *
 * Rounded **down**, so the site never pays out more than the reader
 * paid in. The lost fraction is at most one hundredth of a credit per
 * delivery, which the carry cannot recover — the alternative is
 * tracking ten-thousandths to fix a rounding error nobody can perceive.
 */
export function shareForDelivery({
  creditsSpent,
  rightsStatus,
  hasUploader,
}: {
  creditsSpent: number
  rightsStatus: RightsStatus
  /** False for library books entered by staff: nobody to pay. */
  hasUploader: boolean
}): number {
  if (!hasUploader) return 0
  if (!Number.isFinite(creditsSpent) || creditsSpent <= 0) return 0

  return Math.floor(creditsSpent * sharePercent(rightsStatus))
}

export interface Settlement {
  /** Whole credits to add to the uploader's balance now. */
  credits: number
  /** Points left over, carried to the next delivery. */
  carry: number
}

/**
 * Turn accumulated points into credits.
 *
 * Called with whatever the uploader had carried plus what this delivery
 * earned; returns the whole credits to pay and the new carry.
 */
export function settleShare({ carry, points }: { carry: number; points: number }): Settlement {
  const total = Math.max(0, Math.floor(carry)) + Math.max(0, Math.floor(points))
  return {
    credits: Math.floor(total / POINTS_PER_CREDIT),
    carry: total % POINTS_PER_CREDIT,
  }
}

/** How the share reads to the uploader, for the account page. */
export function shareDescription(rightsStatus: RightsStatus): string | null {
  const percent = sharePercent(rightsStatus)
  if (percent === 0) return null

  return percent === SHARE_PUBLIC_DOMAIN
    ? `You earn ${percent}% of the credits readers spend sending this book — the text is public domain, so the share is for the digitisation.`
    : `You earn ${percent}% of the credits readers spend sending this book.`
}
