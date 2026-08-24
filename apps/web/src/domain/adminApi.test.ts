import { describe, expect, it } from 'vitest'

import {
  BOOK_WRITABLE,
  COLLECTION_WRITABLE,
  parseBookUpdate,
  parseCollectionUpdate,
} from './adminApi'
import { LEVEL_IDS } from './levels'

/**
 * What the admin API will and will not accept.
 *
 * The suite that matters most here is the refusals. A curation script
 * gets one signal — the response — and the whole design rests on a
 * mistyped field being an error rather than a silent no-op.
 */

const ok = (result: ReturnType<typeof parseBookUpdate>) => {
  if (!result.ok) throw new Error(`expected success, got: ${JSON.stringify(result.errors)}`)
  return result.data
}
const fields = (result: ReturnType<typeof parseBookUpdate>) => {
  if (result.ok) throw new Error('expected a refusal')
  return result.errors.map((error) => error.field)
}

describe('the admin API, on a book', () => {
  it('refuses a field it does not write, rather than dropping it', () => {
    // The point of the whole module: answering 200 to `{ levl: … }`
    // would report success having changed nothing.
    expect(fields(parseBookUpdate({ levl: 'essential' }))).toEqual(['levl'])
  })

  it('refuses the fields that belong to somebody else', () => {
    // Owner is the uploader's, review is the queue's, and the rest are
    // the pipeline's or derived. None may be set by curation.
    for (const field of ['owner', 'review', 'conversion', 'artifacts', 'priceCredits', 'pageCount']) {
      expect(fields(parseBookUpdate({ [field]: 1 }))).toEqual([field])
      expect(BOOK_WRITABLE).not.toContain(field)
    }
  })

  it('takes a level by name and stores its id', () => {
    // Names have no order; ids do. Taking the name at the boundary is
    // what keeps stored ids out of every client.
    expect(ok(parseBookUpdate({ level: 'essential' })).level).toBe(LEVEL_IDS.essential)
    expect(ok(parseBookUpdate({ level: 'extensive' })).level).toBe(LEVEL_IDS.extensive)
    expect(fields(parseBookUpdate({ level: LEVEL_IDS.normal }))).toEqual(['level'])
    expect(fields(parseBookUpdate({ level: 'ESSENTIAL' }))).toEqual(['level'])
  })

  it('will not empty a title, and trims one it accepts', () => {
    expect(ok(parseBookUpdate({ title: '  道德經  ' })).title).toBe('道德經')
    expect(fields(parseBookUpdate({ title: '   ' }))).toEqual(['title'])
    expect(fields(parseBookUpdate({ title: null }))).toEqual(['title'])
  })

  it('clears an optional text field on null but not on the wrong type', () => {
    expect(ok(parseBookUpdate({ author: null })).author).toBe(null)
    expect(ok(parseBookUpdate({ author: '   ' })).author).toBe(null)
    expect(fields(parseBookUpdate({ author: 42 }))).toEqual(['author'])
  })

  it('keeps a slug to one URL segment', () => {
    expect(ok(parseBookUpdate({ slug: 'tao-te-ching' })).slug).toBe('tao-te-ching')
    expect(fields(parseBookUpdate({ slug: 'books/tao' }))).toEqual(['slug'])
    expect(fields(parseBookUpdate({ slug: 'tao te ching' }))).toEqual(['slug'])
    expect(fields(parseBookUpdate({ slug: '' }))).toEqual(['slug'])
  })

  it('replaces the shelves, and an empty list is a real instruction', () => {
    expect(ok(parseBookUpdate({ collections: [3, 1] })).collections).toEqual([3, 1])
    // "Take it off every shelf" — not a missing value.
    expect(ok(parseBookUpdate({ collections: [] })).collections).toEqual([])
    expect(ok(parseBookUpdate({ collections: [2, 2, 5] })).collections).toEqual([2, 5])
    expect(fields(parseBookUpdate({ collections: [0] }))).toEqual(['collections'])
    expect(fields(parseBookUpdate({ collections: ['3'] }))).toEqual(['collections'])
    expect(fields(parseBookUpdate({ collections: 3 }))).toEqual(['collections'])
  })

  it('holds rights, visibility and language to their own vocabularies', () => {
    expect(ok(parseBookUpdate({ rightsStatus: 'public_domain' })).rightsStatus).toBe('public_domain')
    expect(fields(parseBookUpdate({ rightsStatus: 'public-domain' }))).toEqual(['rightsStatus'])
    expect(ok(parseBookUpdate({ visibility: 'private' })).visibility).toBe('private')
    expect(fields(parseBookUpdate({ visibility: 'hidden' }))).toEqual(['visibility'])
    expect(ok(parseBookUpdate({ language: 'zh-Hant' })).language).toBe('zh-Hant')
    expect(fields(parseBookUpdate({ language: 'zh' }))).toEqual(['language'])
  })

  it('reports every bad field at once, not just the first', () => {
    // A script fixing one error at a time across six round trips is a
    // worse API than one that says everything wrong in a single answer.
    expect(fields(parseBookUpdate({ level: 'deep', visibility: 'hidden', nope: 1 })).sort()).toEqual(
      ['level', 'nope', 'visibility'],
    )
  })

  it('refuses a body that is not an object, and one that is empty', () => {
    expect(parseBookUpdate(null).ok).toBe(false)
    expect(parseBookUpdate([]).ok).toBe(false)
    expect(parseBookUpdate('title').ok).toBe(false)
    expect(parseBookUpdate({}).ok).toBe(false)
  })
})

describe('the admin API, on a collection', () => {
  it('writes only the four things a shelf is', () => {
    expect([...COLLECTION_WRITABLE]).toEqual(['title', 'description', 'parent', 'sortOrder'])
    // The slug is a shelf's identity in a URL and is not curation.
    expect(fields(parseCollectionUpdate({ slug: 'x' }))).toEqual(['slug'])
  })

  it('takes null as "make this a root shelf"', () => {
    expect(ok(parseCollectionUpdate({ parent: null })).parent).toBe(null)
    expect(ok(parseCollectionUpdate({ parent: 4 })).parent).toBe(4)
    expect(fields(parseCollectionUpdate({ parent: 0 }))).toEqual(['parent'])
    expect(fields(parseCollectionUpdate({ parent: '4' }))).toEqual(['parent'])
  })

  it('takes a sort order, including zero and null', () => {
    // Zero is first, not absent — a falsy check here would silently
    // refuse the one value that means "put it at the front".
    expect(ok(parseCollectionUpdate({ sortOrder: 0 })).sortOrder).toBe(0)
    expect(ok(parseCollectionUpdate({ sortOrder: null })).sortOrder).toBe(null)
    expect(fields(parseCollectionUpdate({ sortOrder: 1.5 }))).toEqual(['sortOrder'])
  })

  it('does not decide nesting — that is the collection hook, for every door', () => {
    // A shelf standing on itself parses fine and is refused on the
    // write. One copy of the rule, not two.
    expect(parseCollectionUpdate({ parent: 7 }).ok).toBe(true)
  })
})
