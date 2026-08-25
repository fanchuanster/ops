/**
 * Google Analytics, if it is configured and if this is the real site.
 *
 * Two conditions, and the second one is the interesting one.
 *
 * `GA_MEASUREMENT_ID` is a var rather than a constant in source, the
 * same shape as `isGoogleSignInConfigured` in `lib/googleOAuth.ts`. It
 * is not a secret — a measurement ID ships inside the page to every
 * visitor by design — so it belongs in `wrangler.jsonc` vars beside
 * `NEXT_PUBLIC_SERVER_URL` and not in `wrangler secret`.
 *
 * But `vars` are read by `wrangler dev` too, so "unset locally" is not
 * a thing that happens: without the host check below, every local
 * session and every `*.workers.dev` preview would land in the same
 * reports as real readers and quietly ruin them. So the tag renders
 * only when the request actually arrived at the canonical public
 * origin, which the application already knows because Payload scopes
 * CSRF to it.
 *
 * Read on the server and handed to the client component as a prop
 * rather than compiled in through a `NEXT_PUBLIC_` name: those are
 * inlined at build time, which would bake the ID into the bundle and
 * make changing it a rebuild rather than an edit and a deploy — and
 * would leave no way to make the decision per request at all.
 */

/** The host of the canonical public site, or null if it is not set. */
function canonicalHost(): string | null {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  if (!configured) return null
  try {
    return new URL(configured).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The `G-XXXXXXXX` id to measure this request with, or null.
 *
 * `host` is the request's own Host header. A mismatch is not an error
 * and is not logged: a developer on `localhost:8787` is the expected
 * case, not a misconfiguration.
 */
export function analyticsMeasurementId(host: string | null): string | null {
  const id = process.env.GA_MEASUREMENT_ID?.trim()
  if (!id) return null

  // Shaped like a GA4 measurement ID, so a stray value in the
  // environment cannot put something else into a script URL.
  if (!/^G-[A-Z0-9]+$/i.test(id)) return null

  const canonical = canonicalHost()
  if (!canonical || !host || host.toLowerCase() !== canonical) return null

  return id
}
