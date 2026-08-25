/**
 * Formatting shared by the admin screens.
 *
 * Dates are formatted on the server and handed to the client as
 * strings. That is not only tidiness: the admin's lists are server
 * components feeding client ones, and a `toLocaleDateString` running on
 * both sides would render the reviewer's timezone on one and the
 * Worker's on the other, which React reports as a hydration mismatch.
 */

/**
 * 2026-08-21, or the fallback. Never "Invalid Date".
 *
 * ISO rather than a locale format because these are records, read
 * beside each other and sorted by eye: a fixed-width date compares at a
 * glance and does not move when the reader does.
 */
export function shortDate(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10)
}
