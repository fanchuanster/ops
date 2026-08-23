import React from 'react'

import { CollectionsPanel } from '../../../../components/admin/CollectionsPanel'
import {
  buildTree,
  depthOf,
  eligibleParents,
  flattenTree,
  parentIdOf,
  subtreeIds,
} from '../../../../domain/collectionTree'
import { booksPerCollection, getAdminCollections } from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Collections' }

/**
 * The shelves, how they nest, and the order a reader meets them in.
 *
 * The home page is a column of these, so the first one is the one most
 * visitors will ever look at. Until now that was whichever collection
 * happened to start with the earliest letter; the arrows here are what
 * make it a decision somebody took.
 *
 * The tree is flattened here rather than in the panel, so the client
 * component receives a plain list it can render straight down the page.
 * Everything it needs to draw a row — its depth, which siblings it sits
 * between, and where it may legally be moved — is computed on the
 * server, where the rules already live.
 */
export default async function AdminCollectionsPage() {
  await requireAdmin()

  const [collections, shelved] = await Promise.all([
    getAdminCollections(),
    booksPerCollection(),
  ])

  const asOption = (collection: (typeof collections)[number]) => ({
    id: collection.id,
    title: collection.title,
    depth: depthOf(collections, collection.id),
  })

  // Flattened in tree order — a parent immediately followed by its
  // children — because the panel draws one card per row and indents by
  // depth. `first`/`last` are among siblings, since that is the only
  // group the arrows move within.
  const tree = buildTree(collections)
  const rows = flattenTree(tree).map((node) => {
    const siblings = collections.filter(
      (other) => parentIdOf(other) === parentIdOf(node.collection),
    )
    const subtree = subtreeIds(collections, node.collection.id)

    return {
      id: node.collection.id,
      title: node.collection.title,
      description: node.collection.description ?? '',
      books: shelved.get(node.collection.id)?.size ?? 0,
      // What a reader actually finds on this shelf, which for a parent
      // is more than what is filed on it directly.
      booksInSubtree: new Set(subtree.flatMap((id) => [...(shelved.get(id) ?? [])])).size,
      depth: node.depth,
      parentId: parentIdOf(node.collection),
      parentOptions: eligibleParents(collections, node.collection.id).map(asOption),
      first: siblings[0]?.id === node.collection.id,
      last: siblings[siblings.length - 1]?.id === node.collection.id,
    }
  })

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
          collections={rows}
          newParentOptions={eligibleParents(collections, null).map(asOption)}
        />
      </div>
    </div>
  )
}
