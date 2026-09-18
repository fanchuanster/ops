import { describe, expect, it } from 'vitest'

import {
  artifactKey,
  bookFolder,
  coverCandidateKey,
  coverKey,
  decisionsKey,
  numbered,
  suggestionsKey,
} from './bookStorage'
import { originalKey } from './publication'

describe('every object a book owns', () => {
  it('lives in a folder named after the book', () => {
    expect(bookFolder(34)).toBe('books/34/')
    expect(artifactKey(34, 'pdf')).toBe('books/34/book.pdf')
    expect(artifactKey(34, 'docx')).toBe('books/34/master.docx')
    expect(artifactKey(34, 'epub')).toBe('books/34/book.epub')
    expect(artifactKey(34, 'txt')).toBe('books/34/book.txt')
    expect(coverKey(34)).toBe('books/34/cover.jpg')
    expect(suggestionsKey(34)).toBe('books/34/suggestions.json')
    expect(decisionsKey(34)).toBe('books/34/decisions.json')
  })

  it('is named for what it is, because the folder says which book', () => {
    for (const key of [artifactKey(34, 'pdf'), coverKey(34), suggestionsKey(34)]) {
      expect(key.startsWith(bookFolder(34))).toBe(true)
    }
    expect(artifactKey(7, 'epub')).toBe(artifactKey(34, 'epub').replace('/34/', '/7/'))
  })

  it('takes an id as a string or a number, since Payload gives either', () => {
    expect(artifactKey('34', 'pdf')).toBe(artifactKey(34, 'pdf'))
  })

  it('files an upload exactly where its artifact slot is', () => {
    expect(originalKey(34, 'docx')).toBe(artifactKey(34, 'docx'))
    expect(originalKey(34, 'pdf')).toBe(artifactKey(34, 'pdf'))
    expect(originalKey(34, 'epub')).toBe(artifactKey(34, 'epub'))
    expect(originalKey(34, 'text')).toBe(artifactKey(34, 'txt'))
  })
})

describe('the cover candidates', () => {
  it('count up from the cover itself', () => {
    expect(coverKey(34, 1)).toBe(coverKey(34))
    expect(coverKey(34, 2)).toBe('books/34/cover-2.jpg')
    expect(coverKey(34, 3)).toBe('books/34/cover-3.jpg')
  })

  it('are suffixed onto whatever key the book recorded', () => {
    expect(coverCandidateKey('books/4/book/original-cover.jpg', 2)).toBe(
      'books/4/book/original-cover-2.jpg',
    )
  })
})

describe('numbering a name that is already taken', () => {
  it('counts up, before the extension', () => {
    expect(numbered('books/34/cover.jpg', 0)).toBe('books/34/cover.jpg')
    expect(numbered('books/34/cover.jpg', 1)).toBe('books/34/cover-2.jpg')
    expect(numbered('books/34/cover.jpg', 2)).toBe('books/34/cover-3.jpg')
  })

  it('is not confused by a dot in a directory name', () => {
    expect(numbered('books/v1.0/master', 1)).toBe('books/v1.0/master-2')
  })
})
