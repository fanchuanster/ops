import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/**
 * OpenNext adapts the Next build output to a Worker.
 *
 * Left at defaults on purpose. The incremental-cache and tag-cache
 * overrides exist for sites that lean on ISR; NobleSee's catalog and
 * book pages are rendered per request against D1 and the reader and
 * download routes are authenticated and uncacheable, so adding a cache
 * layer here would buy nothing and would risk serving one reader's
 * authorized response to another.
 */
export default defineCloudflareConfig()
