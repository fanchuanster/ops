import type { RightsStatus } from './rights'

export const SHARE_PUBLIC_DOMAIN = 33
export const SHARE_LICENSED = 66

export const POINTS_PER_CREDIT = 100

export function sharePercent(rightsStatus: RightsStatus): number {
  switch (rightsStatus) {
    case 'public_domain':
      return SHARE_PUBLIC_DOMAIN
    case 'licensed':
    case 'permission_granted':
      return SHARE_LICENSED
    default:
      return 0
  }
}

export function shareForDelivery({
  creditsSpent,
  rightsStatus,
  hasUploader,
}: {
  creditsSpent: number
  rightsStatus: RightsStatus
  hasUploader: boolean
}): number {
  if (!hasUploader) return 0
  if (!Number.isFinite(creditsSpent) || creditsSpent <= 0) return 0

  return Math.floor(creditsSpent * sharePercent(rightsStatus))
}

export interface Settlement {
  credits: number
  carry: number
}

export function settleShare({ carry, points }: { carry: number; points: number }): Settlement {
  const total = Math.max(0, Math.floor(carry)) + Math.max(0, Math.floor(points))
  return {
    credits: Math.floor(total / POINTS_PER_CREDIT),
    carry: total % POINTS_PER_CREDIT,
  }
}

export function shareDescription(rightsStatus: RightsStatus): string | null {
  const percent = sharePercent(rightsStatus)
  if (percent === 0) return null

  return percent === SHARE_PUBLIC_DOMAIN
    ? `You earn ${percent}% of the credits readers spend sending this book — the text is public domain, so the share is for the digitisation.`
    : `You earn ${percent}% of the credits readers spend sending this book.`
}
