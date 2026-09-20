import type { Payload, Where } from 'payload'

import { disambiguated } from '../domain/slug'

const MAX_ATTEMPTS = 100

export async function freeBookSlug(
  payload: Payload,
  base: string,
  excludeId?: number | string,
): Promise<string> {
  const conditions: Where[] = [{ slug: { like: base } }]
  if (excludeId !== undefined) conditions.push({ id: { not_equals: excludeId } })

  const neighbours = await payload.find({
    collection: 'books',
    where: { and: conditions },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const taken = new Set(neighbours.docs.map((doc) => doc.slug))
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = disambiguated(base, attempt)
    if (!taken.has(candidate)) return candidate
  }

  return `${base}-${Date.now().toString(36)}`
}
