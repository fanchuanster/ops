import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

const UPLOAD_SUFFIX = /-[0-9a-f]{8}$/

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/, '')
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const books = (await db.all(
    sql`SELECT \`id\`, \`title\`, \`slug\` FROM \`books\` ORDER BY \`id\`;`,
  )) as { id: number; title: string; slug: string }[]

  const taken = new Set(books.filter((book) => !UPLOAD_SUFFIX.test(book.slug)).map((b) => b.slug))

  for (const book of books) {
    if (!UPLOAD_SUFFIX.test(book.slug)) continue

    const base = slugify(book.title) || 'book'
    let slug = base
    for (let attempt = 2; taken.has(slug); attempt++) slug = `${base}-${attempt}`
    taken.add(slug)

    if (slug === book.slug) continue
    await db.run(sql`UPDATE \`books\` SET \`slug\` = ${slug} WHERE \`id\` = ${book.id};`)
  }
}

export async function down({}: MigrateDownArgs): Promise<void> {}
