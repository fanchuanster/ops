import type { MetadataRoute } from 'next'

import { CATALOG_LIMIT, getCatalog } from '../lib/catalog'
import { siteUrl } from '../lib/siteUrl'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const { books } = await getCatalog({ level: 'extensive', limit: CATALOG_LIMIT })

  return [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/books`, changeFrequency: 'daily', priority: 0.9 },
    ...books.map((book) => ({
      url: `${base}/books/${book.slug}`,
      lastModified: book.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
}
