import React from 'react'

import { BookTile } from '../../components/BookTile'
import { ShareCta } from '../../components/ShareCta'
import { buildTree, subtreeIds } from '../../domain/collectionTree'
import { getCatalog, getCollections } from '../../lib/catalog'

// Rendered per-request: it queries the database, which is deliberately
// not reachable during `next build`.
export const dynamic = 'force-dynamic'

/** How many shelves the homepage shows before sending you to /books. */
const MAX_SHELVES = 2

/** And how many books stand on each one. */
const PER_SHELF = 4

/**
 * What actually happens to a book, in the order it happens.
 *
 * Three claims, not four. "Proofread & reflowed" was here until
 * 2026-08-21 and the design dropped it — it describes how the sausage
 * is made, while the other three describe what the reader gets.
 */
const STEPS = [
  {
    n: '01',
    title: 'Curated quality',
    body: 'Every book is chosen for lasting value and reviewed by an editor.',
  },
  {
    n: '02',
    title: 'Read anywhere',
    body: 'Clean EPUB and PDF on your phone, tablet, or Kindle.',
  },
  {
    n: '03',
    title: 'Send to Kindle',
    body: 'One tap to your Kindle library — no cables, no fuss.',
  },
]

export default async function HomePage() {
  // Enough books to fill the shelves below, drawn once and grouped
  // here — one catalog query rather than one per collection.
  const [{ books }, collections] = await Promise.all([
    getCatalog({ limit: 48 }),
    getCollections(),
  ])

  // Grouped by collection so the shape of the curation is visible on the
  // homepage, rather than a flat grid that says nothing about why these
  // books are together. A book sits on one shelf, so nothing here can
  // print it twice — but a *parent* still shows it, because the filter
  // below is the whole subtree.
  //
  // Top-level collections only, each carrying everything beneath it.
  // The home page shows two shelves; spending one of them on a
  // sub-shelf would show a visitor the library's filing rather than its
  // subjects (`domain/collectionTree.ts`).
  const shelves = buildTree(collections)
    .map((node) => {
      const ids = new Set(subtreeIds(collections, node.collection.id).map(String))
      return {
        collection: node.collection,
        books: books
          .filter((book) => {
            const shelf = book.collection
            return ids.has(String(typeof shelf === 'object' && shelf ? shelf.id : shelf))
          })
          .slice(0, PER_SHELF),
      }
    })
    .filter((shelf) => shelf.books.length > 0)
    .slice(0, MAX_SHELVES)

  return (
    <>
      <main className="page">
        <section className="hero">
          <div className="hero__lede">
            <p className="eyebrow">A curated reading library</p>
            <h1>
              Books worth reading,
              <br className="hero__break" /> made comfortable
              <br className="hero__break" /> to read.
            </h1>
            <p>
              Quality books in clean, reflowable editions — on your Kindle, phone, or any screen.
            </p>
            <a className="cta" href="/books">
              Browse the library
            </a>
          </div>
        </section>

        {books.length === 0 ? (
          <p className="empty">
            No books published yet. Add one in the <a href="/cms">CMS</a>.
          </p>
        ) : (
          <div className="shelves">
            {shelves.map(({ collection, books: shelfBooks }) => (
              <section key={collection.id}>
                <div className="shelf__head">
                  <a href={`/books?collection=${encodeURIComponent(collection.slug)}`}>
                    {collection.title}
                  </a>
                  <span className="shelf__rule" />
                </div>
                <ul className="shelf__books">
                  {shelfBooks.map((book) => (
                    <BookTile key={book.id} book={book} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <section className="band band--tint">
        <div className="band__inner">
          <p className="eyebrow">How it works</p>
          <h2>Your book, on every device.</h2>
          <ul className="steps">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span className="steps__num">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <main className="page">
        <ShareCta />
      </main>
    </>
  )
}
