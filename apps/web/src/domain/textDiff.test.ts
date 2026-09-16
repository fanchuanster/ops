import { describe, expect, it } from 'vitest'

import { classify } from './proofread'
import { SequenceMatcher, codePoints } from './textDiff'

const CPYTHON_DIFFLIB =
[
  {
    "a": "",
    "b": "",
    "ratio": 1.0,
    "opcodes": [],
    "category": "punctuation",
    "contentEdits": 0
  },
  {
    "a": "abc",
    "b": "abc",
    "ratio": 1.0,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 3,
        "j1": 0,
        "j2": 3
      }
    ],
    "category": "punctuation",
    "contentEdits": 0
  },
  {
    "a": "abc",
    "b": "abd",
    "ratio": 0.6666666666666666,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 2,
        "j1": 0,
        "j2": 2
      },
      {
        "tag": "replace",
        "i1": 2,
        "i2": 3,
        "j1": 2,
        "j2": 3
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "",
    "b": "abc",
    "ratio": 0.0,
    "opcodes": [
      {
        "tag": "insert",
        "i1": 0,
        "i2": 0,
        "j1": 0,
        "j2": 3
      }
    ],
    "category": "characters",
    "contentEdits": 3
  },
  {
    "a": "abcdef",
    "b": "acdefg",
    "ratio": 0.8333333333333334,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 1,
        "j1": 0,
        "j2": 1
      },
      {
        "tag": "delete",
        "i1": 1,
        "i2": 2,
        "j1": 1,
        "j2": 1
      },
      {
        "tag": "equal",
        "i1": 2,
        "i2": 6,
        "j1": 1,
        "j2": 5
      },
      {
        "tag": "insert",
        "i1": 6,
        "i2": 6,
        "j1": 5,
        "j2": 6
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "不能自己",
    "b": "不能自已",
    "ratio": 0.75,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 3,
        "j1": 0,
        "j2": 3
      },
      {
        "tag": "replace",
        "i1": 3,
        "i2": 4,
        "j1": 3,
        "j2": 4
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "學而時習之，不亦說乎",
    "b": "學而時習之,不亦說乎",
    "ratio": 0.9,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 5,
        "j1": 0,
        "j2": 5
      },
      {
        "tag": "replace",
        "i1": 5,
        "i2": 6,
        "j1": 5,
        "j2": 6
      },
      {
        "tag": "equal",
        "i1": 6,
        "i2": 10,
        "j1": 6,
        "j2": 10
      }
    ],
    "category": "punctuation",
    "contentEdits": 0
  },
  {
    "a": "子曰：學而時習之",
    "b": "子曰:學而時習之",
    "ratio": 0.875,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 2,
        "j1": 0,
        "j2": 2
      },
      {
        "tag": "replace",
        "i1": 2,
        "i2": 3,
        "j1": 2,
        "j2": 3
      },
      {
        "tag": "equal",
        "i1": 3,
        "i2": 8,
        "j1": 3,
        "j2": 8
      }
    ],
    "category": "punctuation",
    "contentEdits": 0
  },
  {
    "a": "私淑諸人也",
    "b": "私淑諸人也。",
    "ratio": 0.9090909090909091,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 5,
        "j1": 0,
        "j2": 5
      },
      {
        "tag": "insert",
        "i1": 5,
        "i2": 5,
        "j1": 5,
        "j2": 6
      }
    ],
    "category": "punctuation",
    "contentEdits": 0
  },
  {
    "a": "kitten",
    "b": "sitting",
    "ratio": 0.6153846153846154,
    "opcodes": [
      {
        "tag": "replace",
        "i1": 0,
        "i2": 1,
        "j1": 0,
        "j2": 1
      },
      {
        "tag": "equal",
        "i1": 1,
        "i2": 4,
        "j1": 1,
        "j2": 4
      },
      {
        "tag": "replace",
        "i1": 4,
        "i2": 5,
        "j1": 4,
        "j2": 5
      },
      {
        "tag": "equal",
        "i1": 5,
        "i2": 6,
        "j1": 5,
        "j2": 6
      },
      {
        "tag": "insert",
        "i1": 6,
        "i2": 6,
        "j1": 6,
        "j2": 7
      }
    ],
    "category": "characters",
    "contentEdits": 5
  },
  {
    "a": "這是一個測試",
    "b": "這是二個測試",
    "ratio": 0.8333333333333334,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 2,
        "j1": 0,
        "j2": 2
      },
      {
        "tag": "replace",
        "i1": 2,
        "i2": 3,
        "j1": 2,
        "j2": 3
      },
      {
        "tag": "equal",
        "i1": 3,
        "i2": 6,
        "j1": 3,
        "j2": 6
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "兩個字都變了",
    "b": "两个字都变了",
    "ratio": 0.5,
    "opcodes": [
      {
        "tag": "replace",
        "i1": 0,
        "i2": 2,
        "j1": 0,
        "j2": 2
      },
      {
        "tag": "equal",
        "i1": 2,
        "i2": 4,
        "j1": 2,
        "j2": 4
      },
      {
        "tag": "replace",
        "i1": 4,
        "i2": 5,
        "j1": 4,
        "j2": 5
      },
      {
        "tag": "equal",
        "i1": 5,
        "i2": 6,
        "j1": 5,
        "j2": 6
      }
    ],
    "category": "characters",
    "contentEdits": 6
  },
  {
    "a": "𠀋𠀌𠀍",
    "b": "𠀋𠀎𠀍",
    "ratio": 0.6666666666666666,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 1,
        "j1": 0,
        "j2": 1
      },
      {
        "tag": "replace",
        "i1": 1,
        "i2": 2,
        "j1": 1,
        "j2": 2
      },
      {
        "tag": "equal",
        "i1": 2,
        "i2": 3,
        "j1": 2,
        "j2": 3
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "aaaa",
    "b": "aa",
    "ratio": 0.6666666666666666,
    "opcodes": [
      {
        "tag": "equal",
        "i1": 0,
        "i2": 2,
        "j1": 0,
        "j2": 2
      },
      {
        "tag": "delete",
        "i1": 2,
        "i2": 4,
        "j1": 2,
        "j2": 2
      }
    ],
    "category": "characters",
    "contentEdits": 2
  },
  {
    "a": "ababab",
    "b": "bababa",
    "ratio": 0.8333333333333334,
    "opcodes": [
      {
        "tag": "insert",
        "i1": 0,
        "i2": 0,
        "j1": 0,
        "j2": 1
      },
      {
        "tag": "equal",
        "i1": 0,
        "i2": 5,
        "j1": 1,
        "j2": 6
      },
      {
        "tag": "delete",
        "i1": 5,
        "i2": 6,
        "j1": 6,
        "j2": 6
      }
    ],
    "category": "characters",
    "contentEdits": 2
  }
] as const

describe('SequenceMatcher, against CPython difflib', () => {
  for (const expected of CPYTHON_DIFFLIB) {
    const label = `${JSON.stringify(expected.a)} -> ${JSON.stringify(expected.b)}`

    it(`matches the ratio for ${label}`, () => {
      expect(new SequenceMatcher(expected.a, expected.b).ratio()).toBeCloseTo(
        expected.ratio,
        12,
      )
    })

    it(`matches the opcodes for ${label}`, () => {
      expect(new SequenceMatcher(expected.a, expected.b).getOpcodes()).toEqual(
        expected.opcodes,
      )
    })

    it(`matches the edit classification for ${label}`, () => {
      expect(classify(expected.a, expected.b)).toEqual({
        category: expected.category,
        contentEdits: expected.contentEdits,
      })
    })
  }
})

describe('codePoints', () => {
  it('counts a character beyond the BMP once, as Python does', () => {
    expect(codePoints('\u{2000B}').length).toBe(1)
    expect('\u{2000B}'.length).toBe(2)
  })
})
