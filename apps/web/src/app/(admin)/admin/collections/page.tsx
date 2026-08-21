import React from 'react'

import { CollectionsPanel } from '../../../../components/admin/CollectionsPanel'
import { countBooksPerCollection, getAdminCollections } from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Collections' }

/**
 * The shelves, and the order a reader meets them in.
 *
 * The home page is a column of these, so the first one is the one most
 * visitors will ever look at. Until now that was whichever collection
 * happened to start with the earliest letter; the arrows here are what
 * make it a decision somebody took.
 */
export default async function AdminCollectionsPage() {
  await requireAdmin()

  const [collections, counts] = await Promise.all([
    getAdminCollections(),
    countBooksPerCollection(),
  ])

  return (
    <div className="admin-pane">
      <header className="admin-head">
        <div>
          <h1>Collections</h1>
          <p>
            {collections.length} {collections.length === 1 ? 'shelf' : 'shelves'} · the order here
            is the order readers see
          </p>
        </div>
      </header>

      <div className="admin-scroll admin-scroll--pad">
        <CollectionsPanel
          collections={collections.map((collection) => ({
            id: collection.id,
            title: collection.title,
            description: collection.description ?? '',
            books: counts.get(collection.id) ?? 0,
          }))}
        />
      </div>
    </div>
  )
}
