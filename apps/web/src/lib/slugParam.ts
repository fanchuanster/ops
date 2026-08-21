/**
 * A dynamic route segment is a URL segment, not yet a slug.
 *
 * Next hands `params` through **percent-encoded** for anything outside
 * the unreserved ASCII set. `/books/%E5%A3%BD%E5%BA%B7…` arrives as the
 * literal 81-character string `%E5%A3%BD%E5%BA%B7…`, not as 壽康…, so a
 * lookup by that value matches nothing and the page answers 404 while
 * the book sits in the database perfectly readable. Unreserved ASCII
 * escapes are normalized away before the app ever sees them
 * (`/books/%61nalects` arrives as `analects`), which is exactly why the
 * problem is invisible on an English catalog and total on a Chinese
 * one — and this library's centre of gravity is Chinese titles.
 *
 * A slug can never contain a literal `%`: `slugify` in the upload
 * action keeps only letters and numbers. But a hand-typed or truncated
 * segment can still be malformed, and a malformed URL must answer 404
 * rather than 500 — so a `URIError` falls back to the raw value, which
 * then simply finds nothing.
 */
export function slugFromParam(param: string): string {
  try {
    return decodeURIComponent(param)
  } catch {
    return param
  }
}
