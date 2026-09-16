const AUTO_SUFFIX = /-([0-9a-f]{8})$/

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/, '')
}

export function bookSlug(title: string, suffix: string): string {
  return `${slugify(title) || 'book'}-${suffix}`
}

export function autoSlugSuffix(slug: string): string | null {
  const found = AUTO_SUFFIX.exec(slug)
  return found ? found[1] : null
}

export function renamedSlug(currentSlug: string, title: string): string | null {
  const suffix = autoSlugSuffix(currentSlug)
  if (!suffix) return null

  const next = bookSlug(title, suffix)
  if (next === currentSlug) return null
  return next
}
