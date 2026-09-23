import { describe, expect, it } from 'vitest'

import { FIRST_PAGE_TEXT_CHARS, identifyPrompt, parseIdentity } from './bookIdentity'

describe('reading what the model says a first page shows', () => {
  it('takes title, author and language from a clean answer', () => {
    expect(
      parseIdentity('{"title":"了凡四訓","author":"袁了凡","language":"zh-Hant"}'),
    ).toEqual({ title: '了凡四訓', author: '袁了凡', language: 'zh-Hant' })
  })

  it('finds the object inside prose or a code fence', () => {
    expect(parseIdentity('```json\n{"title":"论语别裁"}\n```')).toEqual({ title: '论语别裁' })
  })

  it('drops what the page did not show', () => {
    expect(parseIdentity('{"title":"欲海回狂","author":null,"language":null}')).toEqual({
      title: '欲海回狂',
    })
  })

  it('treats placeholder words as nothing', () => {
    expect(parseIdentity('{"title":"Unknown","author":"未知"}')).toEqual({})
  })

  it('refuses a language the book record cannot hold', () => {
    expect(parseIdentity('{"title":"X","language":"ja"}')).toEqual({ title: 'X' })
  })

  it('collapses whitespace and caps the length', () => {
    const long = 'a'.repeat(500)
    expect(parseIdentity(`{"title":"  金刚经\\n说什么 ","author":"${long}"}`)).toEqual({
      title: '金刚经 说什么',
      author: 'a'.repeat(200),
    })
  })

  it('takes a collection only from the list it was offered', () => {
    const shelves = [{ id: 4, path: 'Authors Collection / 南怀瑾' }]
    expect(parseIdentity('{"collection":4}', shelves)).toEqual({ collection: 4 })
    expect(parseIdentity('{"collection":"4"}', shelves)).toEqual({ collection: 4 })
    expect(parseIdentity('{"collection":9}', shelves)).toEqual({})
    expect(parseIdentity('{"collection":4}')).toEqual({})
  })

  it('ignores a level or order the model volunteers', () => {
    expect(parseIdentity('{"title":"X","level":"essential","order":9}')).toEqual({ title: 'X' })
  })

  it('gives nothing for an answer that is not JSON', () => {
    expect(parseIdentity('I cannot read this page.')).toEqual({})
    expect(parseIdentity('{not json}')).toEqual({})
    expect(parseIdentity('{"title": 3}')).toEqual({})
  })
})

describe('what the model is asked', () => {
  it('names every file the uploader sent, once each', () => {
    const prompt = identifyPrompt(['壽康寶鑑.pdf', '壽康寶鑑-全譯.docx', '壽康寶鑑.pdf'], [], {
      kind: 'none',
    })
    expect(prompt).toContain('- 壽康寶鑑.pdf\n- 壽康寶鑑-全譯.docx')
    expect(prompt.match(/壽康寶鑑\.pdf/g)).toHaveLength(1)
  })

  it('asks from the file names alone when no page could be read', () => {
    expect(identifyPrompt(['资治通鉴.pdf'], [], { kind: 'none' })).toContain('file names alone')
  })

  it('says so when no file name is known', () => {
    expect(identifyPrompt([' ', ''], [], { kind: 'none' })).toContain('none given')
  })

  it('names the image when the page is a picture', () => {
    expect(identifyPrompt(['shoukang.pdf'], [], { kind: 'image' })).toContain('attached as an image')
  })

  it('sends only the first page worth of text', () => {
    const prompt = identifyPrompt(['book.txt'], [], {
      kind: 'text',
      text: 'x'.repeat(FIRST_PAGE_TEXT_CHARS * 2),
    })
    expect(prompt.length).toBeLessThan(FIRST_PAGE_TEXT_CHARS + 200)
  })

  it('lists each collection by id and path, with its description', () => {
    const prompt = identifyPrompt(
      ['a.pdf'],
      [
        { id: 3, path: 'Authors Collection', description: 'Every author is a sub-collection.' },
        { id: 4, path: 'Authors Collection / 南怀瑾' },
      ],
      { kind: 'image' },
    )
    expect(prompt).toContain('3: Authors Collection — Every author is a sub-collection.')
    expect(prompt).toContain('4: Authors Collection / 南怀瑾')
  })
})
