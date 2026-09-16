import { numberedStem, stemFootprint } from '../domain/bookStorage'
import { objectBucket } from './storage'

const MAX_ATTEMPTS = 50

export async function freeStem({
  wanted,
  owned,
}: {
  wanted: string
  owned?: readonly (string | null | undefined)[]
}): Promise<string> {
  const bucket = await objectBucket()
  if (!bucket) return wanted

  const mine = new Set((owned ?? []).filter((key): key is string => typeof key === 'string'))

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = numberedStem(wanted, attempt)
    const taken = await Promise.all(
      stemFootprint(candidate).map(async (key) =>
        mine.has(key) ? false : (await bucket.head(key)) !== null,
      ),
    )
    if (!taken.some(Boolean)) return candidate
  }

  throw new Error(`no free storage name for ${wanted} after ${MAX_ATTEMPTS} attempts`)
}
