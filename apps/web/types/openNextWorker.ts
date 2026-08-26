/**
 * The type of the bundle OpenNext generates, and nothing else.
 *
 * `worker-entry.ts` imports `open-next-worker`, which resolves two
 * different ways on purpose:
 *
 *   tsconfig `paths`   → this file, for types
 *   wrangler `alias`   → `.open-next/worker.js`, for the build
 *
 * The indirection exists because `.open-next/worker.js` is several
 * megabytes of generated JavaScript and `allowJs` is on. Importing it
 * directly makes `tsc` parse the whole bundle on every typecheck, which
 * it does not survive — it exhausts the heap. Nothing here is ever
 * executed; wrangler never sees this file.
 */

interface OpenNextWorker {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
}

declare const worker: OpenNextWorker
export default worker

// Re-exported by the entry point because Cloudflare resolves a Durable
// Object binding's class name against the entry module, not against
// whatever the entry imported.
export declare const DOQueueHandler: unknown
export declare const DOShardedTagCache: unknown
export declare const BucketCachePurge: unknown
