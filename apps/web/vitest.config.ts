import { defineConfig } from 'vitest/config'

/**
 * Without this, vitest ran the domain suite three times: once from
 * `src/`, and once from each copy that a build leaves behind —
 * `.open-next/server-functions/default/src/` and, from the retired
 * container build, `.next/standalone/src/`.
 *
 * Triplicated passes are not just noise. The copies are snapshots of
 * whenever the last build ran, so a green run could be reporting on code
 * that no longer exists, and an edited-but-unbuilt source file would be
 * outvoted two to one by stale duplicates of itself.
 *
 * `include` is anchored at `src/` — build output nests its own `src/`
 * further down, which an anchored glob will not reach — and the
 * exclusions restate the same boundary so a future layout change fails
 * loudly rather than quietly resurrecting the duplicates.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.next/**', '.open-next/**', '.wrangler/**'],
  },
})
