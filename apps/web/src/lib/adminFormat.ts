export function shortDate(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10)
}
