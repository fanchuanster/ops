export interface MatchingBlock {
  a: number
  b: number
  size: number
}

export type OpcodeTag = 'replace' | 'delete' | 'insert' | 'equal'

export interface Opcode {
  tag: OpcodeTag
  i1: number
  i2: number
  j1: number
  j2: number
}

export function codePoints(value: string): string[] {
  return Array.from(value)
}

export class SequenceMatcher {
  private readonly a: string[]
  private readonly b: string[]
  private readonly b2j = new Map<string, number[]>()
  private blocks: MatchingBlock[] | null = null

  constructor(a: string[] | string, b: string[] | string) {
    this.a = typeof a === 'string' ? codePoints(a) : a
    this.b = typeof b === 'string' ? codePoints(b) : b
    this.b.forEach((ch, index) => {
      const at = this.b2j.get(ch)
      if (at) at.push(index)
      else this.b2j.set(ch, [index])
    })
  }

  findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): MatchingBlock {
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()

    for (let i = alo; i < ahi; i += 1) {
      const newj2len = new Map<number, number>()
      for (const j of this.b2j.get(this.a[i]) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        newj2len.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = newj2len
    }

    return { a: besti, b: bestj, size: bestsize }
  }

  getMatchingBlocks(): MatchingBlock[] {
    if (this.blocks) return this.blocks

    const la = this.a.length
    const lb = this.b.length
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]]
    const found: MatchingBlock[] = []

    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number]
      const match = this.findLongestMatch(alo, ahi, blo, bhi)
      if (match.size === 0) continue
      found.push(match)
      if (alo < match.a && blo < match.b) queue.push([alo, match.a, blo, match.b])
      if (match.a + match.size < ahi && match.b + match.size < bhi) {
        queue.push([match.a + match.size, ahi, match.b + match.size, bhi])
      }
    }

    found.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size)

    const merged: MatchingBlock[] = []
    let i1 = 0
    let j1 = 0
    let k1 = 0
    for (const { a: i2, b: j2, size: k2 } of found) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2
      } else {
        if (k1) merged.push({ a: i1, b: j1, size: k1 })
        i1 = i2
        j1 = j2
        k1 = k2
      }
    }
    if (k1) merged.push({ a: i1, b: j1, size: k1 })
    merged.push({ a: la, b: lb, size: 0 })

    this.blocks = merged
    return merged
  }

  getOpcodes(): Opcode[] {
    let i = 0
    let j = 0
    const answer: Opcode[] = []

    for (const { a: ai, b: bj, size } of this.getMatchingBlocks()) {
      let tag: OpcodeTag | '' = ''
      if (i < ai && j < bj) tag = 'replace'
      else if (i < ai) tag = 'delete'
      else if (j < bj) tag = 'insert'
      if (tag) answer.push({ tag, i1: i, i2: ai, j1: j, j2: bj })
      i = ai + size
      j = bj + size
      if (size) answer.push({ tag: 'equal', i1: ai, i2: i, j1: bj, j2: j })
    }

    return answer
  }

  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((total, block) => total + block.size, 0)
    const length = this.a.length + this.b.length
    return length ? (2 * matches) / length : 1
  }
}
