export const RIGHTS_STATUSES = [
  'public_domain',
  'licensed',
  'permission_granted',
  'user_owned',
  'restricted',
  'unknown',
] as const

export type RightsStatus = (typeof RIGHTS_STATUSES)[number]

const PUBLICLY_DISTRIBUTABLE: ReadonlySet<RightsStatus> = new Set<RightsStatus>([
  'public_domain',
  'licensed',
  'permission_granted',
])

export const DISTRIBUTABLE_STATUSES: readonly RightsStatus[] = RIGHTS_STATUSES.filter((status) =>
  PUBLICLY_DISTRIBUTABLE.has(status),
)

export type Visibility = 'public' | 'private'

export interface RightsBearing {
  rightsStatus: RightsStatus
  visibility: Visibility
}

export interface AccessRequest {
  book: RightsBearing
  part?: Pick<RightsBearing, 'rightsStatus'> & { rightsStatus?: RightsStatus }
  userId?: string | null
  ownerId?: string | null
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessDenialReason }

export type AccessDenialReason =
  | 'authentication_required'
  | 'not_owner'
  | 'rights_not_cleared'

export function effectiveRightsStatus(
  bookStatus: RightsStatus,
  partStatus?: RightsStatus,
): RightsStatus {
  if (!partStatus) return bookStatus
  return restrictiveness(partStatus) > restrictiveness(bookStatus) ? partStatus : bookStatus
}

function restrictiveness(status: RightsStatus): number {
  switch (status) {
    case 'public_domain':
      return 0
    case 'licensed':
    case 'permission_granted':
      return 1
    case 'user_owned':
      return 2
    case 'unknown':
      return 3
    case 'restricted':
      return 4
  }
}

export const UPLOADER_RIGHTS = [
  { value: 'public_domain', label: 'It is in the public domain' },
  { value: 'licensed', label: 'I wrote it, or I hold a licence to publish it' },
  { value: 'permission_granted', label: 'I have the rights holder’s permission' },
  { value: 'user_owned', label: 'I own a copy of it' },
] as const satisfies readonly { value: RightsStatus; label: string }[]

export function isUploaderSelectableRights(value: unknown): value is RightsStatus {
  return UPLOADER_RIGHTS.some((option) => option.value === value)
}

export function isPubliclyDistributable(status: RightsStatus): boolean {
  return PUBLICLY_DISTRIBUTABLE.has(status)
}

export const RIGHTS_LABELS: Record<RightsStatus, string> = {
  public_domain: 'Public domain',
  licensed: 'I wrote it, or hold a licence',
  permission_granted: 'Rights holder’s permission',
  user_owned: 'I own a copy',
  restricted: 'Restricted',
  unknown: 'Not sure',
}

export type RightsRisk = 'ok' | 'warn' | 'block'

export function rightsRisk(status: RightsStatus): RightsRisk {
  if (isPubliclyDistributable(status)) return 'ok'
  return status === 'unknown' ? 'warn' : 'block'
}

export function canReadOnline(request: AccessRequest): AccessDecision {
  const { book, part, userId, ownerId } = request
  const status = effectiveRightsStatus(book.rightsStatus, part?.rightsStatus)

  if (book.visibility === 'private') {
    if (!userId) return { allowed: false, reason: 'authentication_required' }
    if (!ownerId || ownerId !== userId) return { allowed: false, reason: 'not_owner' }
    return { allowed: true }
  }

  if (!isPubliclyDistributable(status)) {
    if (status === 'user_owned' && userId && ownerId === userId) return { allowed: true }
    return { allowed: false, reason: 'rights_not_cleared' }
  }

  return { allowed: true }
}

export function canAccessArtifact(request: AccessRequest): AccessDecision {
  const { book, part, userId, ownerId } = request
  const status = effectiveRightsStatus(book.rightsStatus, part?.rightsStatus)

  if (book.visibility === 'private') {
    if (!userId) return { allowed: false, reason: 'authentication_required' }
    if (!ownerId || ownerId !== userId) return { allowed: false, reason: 'not_owner' }
    return { allowed: true }
  }

  if (!isPubliclyDistributable(status)) {
    if (status === 'user_owned' && userId && ownerId === userId) return { allowed: true }
    return { allowed: false, reason: 'rights_not_cleared' }
  }

  if (!userId) return { allowed: false, reason: 'authentication_required' }

  return { allowed: true }
}
