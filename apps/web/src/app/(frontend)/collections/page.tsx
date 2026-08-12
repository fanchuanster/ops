import React from 'react'

import { getCollections } from '../../../lib/catalog'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Collections' }

export default async function CollectionsPage() {
  const collections = await getCollections()

  // Nested collections ("Authors / Nan Huaijin") render under their
  // parent rather than as siblings, so the shape of the curation is
  // visible instead of flattened into one long list.
  const roots = collections.filter((c) => !c.parent)
  const childrenOf = (id: string | number) =>
    collections.filter((c) => (typeof c.parent === 'object' ? c.parent?.id : c.parent) === id)

  return (
    <main className="page">
      <div className="section-head">
        <h2>Collections</h2>
      </div>

      {roots.length === 0 ? (
        <p className="empty">No collections yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxWidth: 'var(--measure)' }}>
          {roots.map((c) => {
            const children = childrenOf(c.id)
            return (
              <li key={c.id} style={{ padding: '1.25rem 0', borderBottom: '1px solid var(--rule)' }}>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.0625rem' }}>
                  <a href={`/books?collection=${encodeURIComponent(c.slug)}`}>{c.title}</a>
                </h3>
                {c.description ? (
                  <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: '0.9375rem' }}>
                    {c.description}
                  </p>
                ) : null}
                {children.length > 0 ? (
                  <nav className="filters" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                    {children.map((child) => (
                      <a key={child.id} href={`/books?collection=${encodeURIComponent(child.slug)}`}>
                        {child.title}
                      </a>
                    ))}
                  </nav>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
