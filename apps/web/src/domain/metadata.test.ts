/**
 * Metadata extraction.
 *
 * Every case here came from a real shape these formats take. The junk
 * filters especially: "Microsoft Word - chapter1.doc" is a title field
 * Word writes by itself, and letting it through would fill the library
 * with books named after the program that made them.
 */

import { describe, expect, it } from 'vitest'

import {
  bytesToBinaryString,
  fromAppXml,
  fromCoreXml,
  fromFilename,
  fromPdfText,
  fromPlainText,
  mergeMetadata,
  normalizeLanguage,
  pdfPageCount,
  repairTogether,
  repairUtf8,
} from './metadata'

describe('DOCX core properties', () => {
  it('reads title, author, description and language', () => {
    expect(
      fromCoreXml(`<?xml version="1.0"?><cp:coreProperties
        xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>論語別裁</dc:title>
        <dc:creator>南懷瑾</dc:creator>
        <dc:description>A commentary.</dc:description>
        <dc:language>zh-TW</dc:language>
      </cp:coreProperties>`),
    ).toEqual({
      title: '論語別裁',
      author: '南懷瑾',
      description: 'A commentary.',
      language: 'zh-Hant',
    })
  })

  it('decodes XML entities', () => {
    expect(fromCoreXml('<dc:title>Tom &amp; Jerry &#8212; a tale</dc:title>').title).toBe(
      'Tom & Jerry — a tale',
    )
  })

  it('falls back to lastModifiedBy when there is no creator', () => {
    expect(fromCoreXml('<cp:lastModifiedBy>An Editor</cp:lastModifiedBy>').author).toBe(
      'An Editor',
    )
  })

  it('drops the junk Word writes by itself', () => {
    for (const junk of [
      'Microsoft Word - chapter1.doc',
      'Untitled',
      'untitled document',
      'Document1',
      'chapter1.docx',
      '   ',
      '---',
    ]) {
      expect(fromCoreXml(`<dc:title>${junk}</dc:title>`).title).toBeUndefined()
    }
  })

  it('returns nothing rather than guessing from an empty file', () => {
    expect(fromCoreXml('<cp:coreProperties/>')).toEqual({})
  })
})

describe('PDF metadata', () => {
  it('reads a literal Info dictionary string', () => {
    const pdf = '/Title (The Analects) /Author (Confucius) /Subject (Sayings)'
    expect(fromPdfText(pdf)).toMatchObject({
      title: 'The Analects',
      author: 'Confucius',
      description: 'Sayings',
    })
  })

  it('unescapes literal strings', () => {
    expect(fromPdfText(String.raw`/Title (Poems \(1891\) \\ notes)`).title).toBe(
      'Poems (1891) \\ notes',
    )
  })

  it('decodes UTF-16BE hex strings, which is how CJK titles arrive', () => {
    // FEFF BOM + 論語 (U+8AD6 U+8A9E)
    expect(fromPdfText('/Title <FEFF8AD68A9E>').title).toBe('論語')
  })

  it('prefers XMP over the Info dictionary when both exist', () => {
    // XMP is the one that gets updated when a file is re-saved.
    const pdf = `
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">The Real Title</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>The Real Author</rdf:li></rdf:Seq></dc:creator>
      /Title (Stale Title) /Author (Stale Author)`
    expect(fromPdfText(pdf)).toMatchObject({
      title: 'The Real Title',
      author: 'The Real Author',
    })
  })

  it('takes the author from Info when XMP has only a title', () => {
    const pdf = `<dc:title><rdf:Alt><rdf:li>A Title</rdf:li></rdf:Alt></dc:title>
      /Author (An Author)`
    expect(fromPdfText(pdf)).toMatchObject({ title: 'A Title', author: 'An Author' })
  })

  it('returns nothing for a PDF with no metadata', () => {
    expect(fromPdfText('%PDF-1.7\nsome binary noise')).toEqual({})
  })

  it('ignores a malformed hex string rather than emitting mojibake', () => {
    expect(fromPdfText('/Title <FEFF8AD>').title).toBeUndefined()
  })
})

describe('plain text and Markdown', () => {
  it('takes the first non-empty line', () => {
    expect(fromPlainText('\n\n  The Analects  \n\nBook I...').title).toBe('The Analects')
  })

  it('strips a Markdown heading marker', () => {
    expect(fromPlainText('# 道德經\n\nchapter one').title).toBe('道德經')
  })

  it('refuses a first line that is prose, rather than truncating it', () => {
    // A truncated paragraph makes a confidently wrong title, which is
    // worse than none — the reader skims past it.
    expect(fromPlainText('x'.repeat(200)).title).toBeUndefined()
  })

  it('returns nothing for an empty file', () => {
    expect(fromPlainText('   \n\n  ')).toEqual({})
  })
})

describe('filename fallback', () => {
  it('tidies separators', () => {
    expect(fromFilename('tao_te-ching.pdf').title).toBe('tao te ching')
  })

  it('refuses a filename that says nothing', () => {
    for (const name of ['scan001.pdf', 'untitled.docx', 'document.pdf']) {
      expect(fromFilename(name).title).toBeUndefined()
    }
  })
})

describe('merging sources', () => {
  it('fills each field from the first source that has it', () => {
    expect(
      mergeMetadata({ title: 'From XMP' }, { title: 'From Info', author: 'From Info' }),
    ).toEqual({ title: 'From XMP', author: 'From Info' })
  })

  it('ignores empty values rather than letting them win', () => {
    expect(mergeMetadata({ title: '' }, { title: 'Real' })).toEqual({ title: 'Real' })
  })
})

describe('language normalisation', () => {
  it('maps the regional variants onto the catalog codes', () => {
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant')
    expect(normalizeLanguage('zh_HK')).toBe('zh-Hant')
    expect(normalizeLanguage('zh-CN')).toBe('zh-Hans')
    expect(normalizeLanguage('en-GB')).toBe('en')
  })

  it('sends bare zh to Traditional, which is what this library mostly is', () => {
    expect(normalizeLanguage('zh')).toBe('zh-Hant')
  })

  it('leaves an unrecognised language unset rather than guessing', () => {
    for (const code of ['ja', 'fr', '', 'xx', undefined]) {
      expect(normalizeLanguage(code)).toBeUndefined()
    }
  })
})

describe('page counts stated by the file', () => {
  it('takes the page tree root count, not an intermediate node', () => {
    // A PDF may nest page-tree nodes, each with its own smaller /Count.
    expect(pdfPageCount('/Type /Pages /Count 12 ... /Type /Pages /Count 342')).toBe(342)
  })

  it('falls back to counting page objects when there is no /Count', () => {
    expect(pdfPageCount('/Type /Page\n/Type /Page\n/Type /Page ')).toBe(3)
  })

  it('is undefined for a PDF that says nothing', () => {
    expect(pdfPageCount('%PDF-1.7 noise')).toBeUndefined()
  })

  it('reads Word statistics from app.xml', () => {
    expect(
      fromAppXml('<Properties><Pages>342</Pages><CharactersWithSpaces>91000</CharactersWithSpaces></Properties>'),
    ).toEqual({ pageCount: 342, characters: 91000 })
  })

  it('is empty for a generator that writes no statistics', () => {
    // python-docx and most libraries write no page count at all.
    expect(fromAppXml('<Properties><Application>python-docx</Application></Properties>')).toEqual({})
  })

  it('ignores a zero page count rather than treating it as measured', () => {
    expect(fromAppXml('<Properties><Pages>0</Pages></Properties>')).toEqual({})
  })
})

describe('CJK text that arrives mis-decoded', () => {
  // A PDF must be read one code unit per byte so the hex strings stay
  // intact, which means any UTF-8 text in it arrives wrong. These are
  // the three ways a producer really writes 論語別裁, and two of them
  // depend on the repair.
  const asBytes = (value: string) =>
    bytesToBinaryString(new TextEncoder().encode(value))

  it('repairs UTF-8 bytes written into a literal string', () => {
    const pdf = `/Title (${asBytes('論語別裁')}) /Author (${asBytes('南懷瑾')})`
    expect(fromPdfText(pdf)).toMatchObject({ title: '論語別裁', author: '南懷瑾' })
  })

  it('repairs an XMP packet, which is always UTF-8 XML', () => {
    const pdf = `<dc:title><rdf:Alt><rdf:li>${asBytes('論語別裁')}</rdf:li></rdf:Alt></dc:title>`
    expect(fromPdfText(pdf).title).toBe('論語別裁')
  })

  it('still reads the UTF-16BE hex form, which was never broken', () => {
    expect(fromPdfText('/Title <FEFF8AD68A9E>').title).toBe('論語')
  })

  it('leaves genuine Latin-1 text alone', () => {
    // é is a single code unit that is not valid UTF-8 on its own, so the
    // strict decode throws and the original survives.
    expect(repairUtf8('Café Littéraire')).toBe('Café Littéraire')
  })

  it('leaves text that was already read correctly alone', () => {
    expect(repairUtf8('論語別裁')).toBe('論語別裁')
    expect(repairUtf8('plain ascii')).toBe('plain ascii')
  })
})

describe('byte strings', () => {
  it('preserves every byte, which TextDecoder("latin1") does not promise', () => {
    // 0x96 is the trap. Per the WHATWG encoding standard the "latin1"
    // label selects *windows-1252*, not ISO-8859-1, and windows-1252
    // maps 0x96 to U+2013 — so the byte is lost and the later
    // GBK/Big5 detection never sees what it needs.
    //
    // Only our own helper is asserted here. Which way TextDecoder
    // actually goes is a property of the host: workerd follows the spec
    // and yields U+2013, while Node 20 on this machine yields 0x96. The
    // production runtime is the one that loses the byte, so the helper
    // is required regardless — but pinning a third party's behaviour in
    // an assertion makes the suite fail when a runtime is upgraded,
    // which tells us nothing about this code.
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0x96, 0x9f, 0xff])
    const encoded = bytesToBinaryString(bytes)
    expect([...encoded].map((c) => c.charCodeAt(0))).toEqual([...bytes])
  })

  it('handles a window larger than the call-stack chunk', () => {
    const big = new Uint8Array(70_000).fill(0xe8)
    expect(bytesToBinaryString(big)).toHaveLength(70_000)
  })
})

describe('Chinese PDFs that are not UTF-8', () => {
  // GBK and Big5 are what Chinese-language software writes into a PDF
  // literal string, and they are exactly the books this library is for.
  // Neither can fail to decode — both turn almost any bytes into valid
  // CJK — so the detector has to judge whether the result is real
  // Chinese, not merely Chinese-shaped.
  const asBytes = (bytes: number[]) => bytesToBinaryString(new Uint8Array(bytes))

  it('reads a GBK title and author', () => {
    const title = asBytes([0xd5, 0x93, 0xd5, 0x5a, 0x84, 0x65, 0xb2, 0xc3]) // 論語別裁
    const author = asBytes([0xc4, 0xcf, 0x91, 0xd1, 0xe8, 0xaa]) // 南懷瑾
    expect(fromPdfText(`/Title (${title}) /Author (${author})`)).toMatchObject({
      title: '論語別裁',
      author: '南懷瑾',
    })
  })

  it('reads a Big5 title', () => {
    const title = asBytes([0xbd, 0xd7, 0xbb, 0x79, 0xa7, 0x4f, 0xb5, 0xf4]) // 論語別裁
    expect(fromPdfText(`/Title (${title})`).title).toBe('論語別裁')
  })

  it('leaves European text alone rather than inventing Chinese', () => {
    // The guard that matters: a legacy decoding is only preferred when
    // it produces characters people actually use.
    expect(repairUtf8('Café Littéraire')).toBe('Café Littéraire')
    expect(repairUtf8('München')).toBe('München')
  })

  it('keeps title and author on the same encoding', () => {
    // Three characters is far too little to tell GBK from Big5 alone,
    // so the fields are judged together and must agree.
    const [title, author] = repairTogether(['論語別裁', '南懷瑾'])
    expect(title).toBe('論語別裁')
    expect(author).toBe('南懷瑾')
  })

  it('passes undefined fields through untouched', () => {
    expect(repairTogether(['x', undefined])).toEqual(['x', undefined])
  })
})

describe('a PDF that mixes encodings between fields', () => {
  // The real-world shape that broke: title as UTF-16BE hex, author as
  // raw UTF-8 in a literal string. Grouping them naively does nothing —
  // the already-decoded title contains characters above U+00FF, so the
  // repair concludes the whole string was decoded and leaves the author
  // garbled.
  const utf8Bytes = (value: string) => bytesToBinaryString(new TextEncoder().encode(value))

  it('decodes a hex title and a UTF-8 author in the same file', () => {
    const pdf = `/Title <FEFF8AD68A9E522588C1> /Author (${utf8Bytes('南懷瑾')})`
    expect(fromPdfText(pdf)).toMatchObject({ title: '論語別裁', author: '南懷瑾' })
  })

  it('leaves an already-decoded field alone while repairing a raw one', () => {
    const [decoded, raw] = repairTogether(['論語別裁', utf8Bytes('南懷瑾')])
    expect(decoded).toBe('論語別裁')
    expect(raw).toBe('南懷瑾')
  })

  it('still groups raw fields so they share one encoding decision', () => {
    const [title, author] = repairTogether([utf8Bytes('論語別裁'), utf8Bytes('南懷瑾')])
    expect(title).toBe('論語別裁')
    expect(author).toBe('南懷瑾')
  })
})

describe('UTF-16 inside a PDF literal string', () => {
  // The shape that was actually reported. PDF allows a byte-order mark
  // in an ordinary (…) string, not only the <hex> form, and this is how
  // producers that handle CJK correctly usually write it.
  const bytes = (values: number[]) => bytesToBinaryString(new Uint8Array(values))
  // Escaped as PDF requires. This is not incidental: 作 is U+4F5C, so
  // its low byte is 0x5C — a backslash — and an unescaped one would be
  // read as an escape introducer and swallow the next byte. Real
  // producers escape it, which is why the reported file contained `\\`.
  const pdfLiteral = (values: number[]) => {
    const out: number[] = []
    for (const byte of values) {
      if (byte === 0x5c || byte === 0x28 || byte === 0x29) out.push(0x5c)
      out.push(byte)
    }
    return bytes(out)
  }
  const utf16be = (text: string) => {
    const out = [0xfe, 0xff]
    for (const character of text) {
      const code = character.codePointAt(0)!
      out.push(code >> 8, code & 0xff)
    }
    return pdfLiteral(out)
  }

  it('decodes a UTF-16BE literal title and author', () => {
    const pdf = `/Title (${utf16be('南怀瑾著作')}) /Author (${utf16be('Wen Dong')})`
    expect(fromPdfText(pdf)).toMatchObject({ title: '南怀瑾著作', author: 'Wen Dong' })
  })

  it('decodes little-endian too', () => {
    const out = [0xff, 0xfe]
    for (const character of '論語') {
      const code = character.codePointAt(0)!
      out.push(code & 0xff, code >> 8)
    }
    expect(fromPdfText(`/Title (${pdfLiteral(out)})`).title).toBe('論語')
  })

  it('keeps a character whose low byte is a carriage return', () => {
    // 复 is U+590D. Collapsing whitespace *before* decoding turns that
    // 0x0D into a space and silently yields 夠 — so decoding has to come
    // first. This is the regression that produced 夠旦大学 for 复旦大学.
    expect(fromPdfText(`/Title (${utf16be('复旦大学出版社')})`).title).toBe('复旦大学出版社')
  })

  it('does not group a UTF-16 field with another field', () => {
    // Joining them on a newline puts an odd byte in the middle and
    // misaligns every character after it.
    const [title, author] = repairTogether([utf16be('南怀瑾'), utf16be('Wen Dong')])
    expect(title).toBe('南怀瑾')
    expect(author).toBe('Wen Dong')
  })

  it('strips a file extension from a title rather than discarding it', () => {
    // Producers routinely put the filename in the title field; the rest
    // of it is usually the best title available.
    expect(fromPdfText(`/Title (${utf16be('南怀瑾著作.pdf')})`).title).toBe('南怀瑾著作')
  })
})
