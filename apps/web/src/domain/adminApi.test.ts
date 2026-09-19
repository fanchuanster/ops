import { describe, expect, it } from 'vitest'

import {
  BOOK_WRITABLE,
  COLLECTION_WRITABLE,
  parseBookUpdate,
  parseCollectionUpdate,
} from './adminApi'
import { LEVEL_IDS } from './levels'
import { FIRST_ORDER_ID, MAX_ORDER_ID } from './shelfOrder'

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
    expect(fields(parseBookUpdate({ levl: 'essential' }))).toEqual(['levl'])
  })

  it('refuses the fields that belong to somebody else', () => {
    for (const field of ['owner', 'review', 'conversion', 'artifacts', 'priceCredits', 'pageCount', 'visibility']) {
      expect(fields(parseBookUpdate({ [field]: 1 }))).toEqual([field])
      expect(BOOK_WRITABLE).not.toContain(field)
    }
  })

  it('takes a level by name and stores its id', () => {
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

  it('takes one shelf, and null is a real instruction', () => {
    expect(ok(parseBookUpdate({ collection: 3 })).collection).toBe(3)
    expect(ok(parseBookUpdate({ collection: null })).collection).toBe(null)
    expect(fields(parseBookUpdate({ collection: 0 }))).toEqual(['collection'])
    expect(fields(parseBookUpdate({ collection: '3' }))).toEqual(['collection'])
    expect(fields(parseBookUpdate({ collection: [3] }))).toEqual(['collection'])
    expect(fields(parseBookUpdate({ collections: [3] }))).toEqual(['collections'])
  })

  it('takes a place on the shelf, and null for the back of it', () => {
    expect(ok(parseBookUpdate({ collectionOrder: 3 })).collectionOrder).toBe(3)
    expect(ok(parseBookUpdate({ collectionOrder: null })).collectionOrder).toBe(null)
    expect(ok(parseBookUpdate({ collectionOrder: 2.5 })).collectionOrder).toBe(2)
    expect(ok(parseBookUpdate({ collectionOrder: 0 })).collectionOrder).toBe(FIRST_ORDER_ID)
    expect(ok(parseBookUpdate({ collectionOrder: 50_000 })).collectionOrder).toBe(MAX_ORDER_ID)
    expect(fields(parseBookUpdate({ collectionOrder: '3' }))).toEqual(['collectionOrder'])
  })

  it('holds rights and language to their own vocabularies', () => {
    expect(ok(parseBookUpdate({ rightsStatus: 'public_domain' })).rightsStatus).toBe('public_domain')
    expect(fields(parseBookUpdate({ rightsStatus: 'public-domain' }))).toEqual(['rightsStatus'])
    expect(ok(parseBookUpdate({ language: 'zh-Hant' })).language).toBe('zh-Hant')
    expect(fields(parseBookUpdate({ language: 'zh' }))).toEqual(['language'])
  })

  it('reports every bad field at once, not just the first', () => {
    expect(fields(parseBookUpdate({ level: 'deep', language: 'zh', nope: 1 })).sort()).toEqual(
      ['language', 'level', 'nope'],
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
  it('writes only the five things a shelf is', () => {
    expect([...COLLECTION_WRITABLE]).toEqual([
      'title',
      'description',
      'parent',
      'sortOrder',
      'childOrder',
    ])
    expect(fields(parseCollectionUpdate({ slug: 'x' }))).toEqual(['slug'])
  })

  it('holds the child order to the two sorts there are', () => {
    expect(ok(parseCollectionUpdate({ childOrder: 'sequence' })).childOrder).toBe('sequence')
    expect(ok(parseCollectionUpdate({ childOrder: 'alphabetical' })).childOrder).toBe(
      'alphabetical',
    )
    expect(fields(parseCollectionUpdate({ childOrder: 'by-vibes' }))).toEqual(['childOrder'])
  })

  it('takes null as "make this a root shelf"', () => {
    expect(ok(parseCollectionUpdate({ parent: null })).parent).toBe(null)
    expect(ok(parseCollectionUpdate({ parent: 4 })).parent).toBe(4)
    expect(fields(parseCollectionUpdate({ parent: 0 }))).toEqual(['parent'])
    expect(fields(parseCollectionUpdate({ parent: '4' }))).toEqual(['parent'])
  })

  it('takes a sort order, including zero and null', () => {
    expect(ok(parseCollectionUpdate({ sortOrder: 0 })).sortOrder).toBe(FIRST_ORDER_ID)
    expect(ok(parseCollectionUpdate({ sortOrder: null })).sortOrder).toBe(null)
    expect(ok(parseCollectionUpdate({ sortOrder: 1.5 })).sortOrder).toBe(1)
  })

  it('does not decide nesting — that is the collection hook, for every door', () => {
    expect(parseCollectionUpdate({ parent: 7 }).ok).toBe(true)
  })
})
