import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * Placeholder catalog. The real reading experience arrives with the
 * frontend phase; this exists so the stack is verifiably wired
 * end-to-end — Next renders, Payload queries, PostgreSQL answers.
 */
// Rendered per-request: it queries the database, which is not
// reachable during `next build`.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config })
  const books = await payload.find({
    collection: 'books',
    limit: 10,
    overrideAccess: false,
  })

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '40rem', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>NobleSee</h1>
      <p>Books worth reading, made comfortable to read.</p>
      <h2>From the library</h2>
      {books.docs.length === 0 ? (
        <p>
          No books published yet. Add one in the <a href="/admin">admin</a>.
        </p>
      ) : (
        <ul>
          {books.docs.map((book) => (
            <li key={book.id}>{book.title}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
