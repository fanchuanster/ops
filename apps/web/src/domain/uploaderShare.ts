import { isPubliclyDistributable, type RightsStatus } from './rights'

export const UPLOADER_SHARE = 66

export const POINTS_PER_CREDIT = 100

export function sharePercent(rightsStatus: RightsStatus): number {
  return isPubliclyDistributable(rightsStatus) ? UPLOADER_SHARE : 0
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

  return `You earn ${percent}% of the credits readers spend sending this book.`
}
