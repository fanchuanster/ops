import React from 'react'

import { BookTile } from '../../components/BookTile'
import { ShareCta } from '../../components/ShareCta'
import { buildTree, subtreeIds } from '../../domain/collectionTree'
import { getCatalog, getCollections } from '../../lib/catalog'

export const dynamic = 'force-dynamic'

const MAX_SHELVES = 1

const PER_SHELF = 4

const STEPS = [
  {
    title: 'Curated quality',
    body: 'Hand-picked by our editor, plus reviewed reader submissions.',
    icon: (
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Read anywhere',
    body: 'Reflowable EPUB and PDF — built for Kindle or any screen.',
    icon: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M10 18h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: 'Send to Kindle',
    body: 'One tap sends any title straight to your device.',
    icon: (
      <>
        <path
          d="M4 12h11m0 0-4-4m4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M17 6h3v12h-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </>
    ),
  },
]

export default async function HomePage() {
  const [{ books }, collections] = await Promise.all([
    getCatalog({ limit: 48 }),
    getCollections(),
  ])

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
            <h1>Books worth reading, made comfortable to read.</h1>
            <p>
              Curated by us and by readers, in clean EPUB and PDF for Kindle, phone, or any screen.
            </p>
            <a className="cta" href="/books">
              Browse the library
            </a>
          </div>
        </section>

        {books.length === 0 ? (
          <p className="empty">
            No books published yet. Add one from the{' '}
            <a href="/admin/library">library</a>.
          </p>
        ) : (
          shelves.map(({ collection, books: shelfBooks }) => (
            <section key={collection.id} className="home-shelf">
              <div className="home-shelf__head">
                <h2>{collection.title}</h2>
                <a href={`/books?collection=${encodeURIComponent(collection.slug)}`}>
                  View all →
                </a>
              </div>
              <ul className="home-shelf__books">
                {shelfBooks.map((book) => (
                  <BookTile key={book.id} book={book} />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      <section className="band">
        <div className="band__inner">
          <h2>How it works</h2>
          <ul className="steps">
            {STEPS.map((step) => (
              <li key={step.title}>
                <span className="steps__icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    {step.icon}
                  </svg>
                </span>
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
