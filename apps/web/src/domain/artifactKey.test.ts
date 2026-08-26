/**
 * Where the pipeline puts what it builds.
 *
 * Pinned against `originalKey`, which is the same layout arrived at from
 * the other direction — it is where an *upload* is filed. The two have
 * to agree, because for a DOCX upload they name the same object: the
 * upload is the master.
 *
 * This exists because the port got it wrong. `artifactPrefix` is the
 * containment boundary (`books/{id}/`, broad enough to admit the cover),
 * not the artifact directory (`books/{id}/book/`), and using the first
 * where the second was meant wrote a working EPUB to a key nothing else
 * in the system looks at.
 */

import { describe, expect, it } from 'vitest'

import { artifactKey, artifactPrefix } from './conversion'
import { originalKey } from './publication'

describe('artifactKey', () => {
  it('files a master where a DOCX upload would already be', () => {
    expect(artifactKey(42, 'master.docx')).toBe(originalKey(42, 'docx'))
  })

  it('files an EPUB where an EPUB upload would already be', () => {
    expect(artifactKey(42, 'book.epub')).toBe(originalKey(42, 'epub'))
  })

  it('puts artifacts under the book directory, not beside the cover', () => {
    expect(artifactKey(42, 'master.docx')).toBe('books/42/book/master.docx')
    expect(artifactKey(42, 'suggestions.json')).toBe('books/42/book/suggestions.json')
  })

  it('stays inside the containment boundary', () => {
    expect(artifactKey(42, 'master.docx').startsWith(artifactPrefix(42))).toBe(true)
  })
})
