/**
 * Recording a failure that the caller is about to hide.
 *
 * A great many `catch` blocks here answer with something gentle — "Could
 * not store that file", `null`, an empty suggestion — because the person
 * on the other end cannot act on a stack trace and must not be shown
 * one. That is right, and it has a cost: the cause is gone. When the
 * conversion portal refused every book for weeks, the action's own
 * message never even reached the reader, and there was nothing in the
 * logs to say why, because nothing had been written.
 *
 * So: gentle to the reader, complete to the log. Call this wherever an
 * error is being converted into a friendly answer.
 *
 * Deliberately *not* everywhere. Several catches here are control flow
 * rather than failure — a `TextDecoder` refusing bytes is how the
 * encoding is identified, and `getCloudflareContext` throwing is how a
 * local run discovers it has no bindings. Logging those would fire on
 * every request and bury the ones that mean something. Each such site
 * says in a comment why it stays quiet.
 *
 * `console.error` rather than a logging library: on a Worker it is what
 * `wrangler tail` and the dashboard read, and it costs nothing when
 * nobody is tailing.
 */

/** Prefix, so `wrangler tail | grep noblesee` finds exactly these. */
const PREFIX = '[noblesee]'

/**
 * Describe an unknown thrown value.
 *
 * Anything can be thrown, and the common non-Error cases here are real:
 * Payload rejects with validation objects, `fetch` with DOMExceptions.
 * A cause chain is followed because the interesting half of an Adobe or
 * D1 failure is usually one level down.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause ? ` <- ${describeError(error.cause)}` : ''
    return `${error.name}: ${error.message}${cause}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    // A circular or exotic value. Its type is still worth having, and
    // failing to log must never itself throw into the catch block that
    // called us.
    return Object.prototype.toString.call(error)
  }
}

/**
 * Log a failure being converted into a friendly answer.
 *
 * `where` is read by a human under time pressure, so make it name the
 * operation and not the function: "upload: store source in R2" beats
 * "uploadBook".
 */
export function logError(where: string, error: unknown): void {
  console.error(`${PREFIX} ${where} — ${describeError(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
}
