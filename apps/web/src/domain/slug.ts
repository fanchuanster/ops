export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/, '')
}

export function bookSlug(title: string): string {
  return slugify(title) || 'book'
}

export function disambiguated(base: string, attempt: number): string {
  return attempt < 2 ? base : `${base}-${attempt}`
}

export function isGeneratedFrom(slug: string, title: string): boolean {
  const base = bookSlug(title)
  if (slug === base) return true
  if (!slug.startsWith(`${base}-`)) return false
  return /^\d+$/.test(slug.slice(base.length + 1))
}

export function renamedSlug(
  currentSlug: string,
  previousTitle: string,
  nextTitle: string,
): string | null {
  if (!isGeneratedFrom(currentSlug, previousTitle)) return null

  const next = bookSlug(nextTitle)
  if (next === currentSlug) return null
  return next
}
