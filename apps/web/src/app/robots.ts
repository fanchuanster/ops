import type { MetadataRoute } from 'next'

import { siteUrl } from '../lib/siteUrl'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/account', '/api', '/login', '/sign-up'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
