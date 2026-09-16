export interface ReaderIdentity {
  email: string
  displayName?: string | null
  avatarUrl?: string | null
}

export function readerName(identity: ReaderIdentity): string {
  const named = identity.displayName?.trim()
  if (named) return named

  const local = identity.email.split('@')[0]?.trim()
  return local || identity.email
}

export function readerInitials(identity: ReaderIdentity): string {
  const source = readerName(identity)

  const words = source.split(/\s+/).filter(Boolean)

  const first = firstCharacter(words[0] ?? source)
  if (words.length < 2) return first.toUpperCase()

  return (first + firstCharacter(words[words.length - 1])).toUpperCase()
}

function firstCharacter(word: string): string {
  return [...word][0] ?? ''
}

export function readerAvatarHue(identity: ReaderIdentity): number {
  let hash = 0
  for (const char of identity.email.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) % 100000
  }
  return (hash % 27) * 10 + 80
}
