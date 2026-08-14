/**
 * What to call a reader, and what to show when there is no picture.
 *
 * Small, but it belongs here rather than in a component: every account
 * has a name we might not have, an address we always have, and a
 * picture we usually do not, and the rules for collapsing those three
 * into "a name and a face" are the same everywhere they are shown. They
 * are also full of edge cases that are much easier to pin down in tests
 * than by signing in as six different readers.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export interface ReaderIdentity {
  email: string
  displayName?: string | null
  avatarUrl?: string | null
}

/**
 * The name to show.
 *
 * Falls back to the local part of the email rather than the whole
 * address: a header is a public surface, and putting someone's full
 * address in it means anyone glancing at their screen — or at a
 * screenshot they post — reads it too. `Your account` shows the full
 * address, which is where it belongs.
 */
export function readerName(identity: ReaderIdentity): string {
  const named = identity.displayName?.trim()
  if (named) return named

  const local = identity.email.split('@')[0]?.trim()
  return local || identity.email
}

/**
 * One or two letters for the fallback avatar.
 *
 * Two initials from a multi-word name, one otherwise. Uses the first
 * *character* rather than the first byte, so a name beginning with a
 * Chinese character gives that character and not half of it — the
 * library is largely Chinese classics and its readers are the same, so
 * this is the common case here rather than an exotic one.
 */
export function readerInitials(identity: ReaderIdentity): string {
  const source = readerName(identity)

  // Split on whitespace only. A CJK name is usually written without
  // spaces, and chopping 王守仁 into three "words" would be wrong; one
  // character is the right answer there.
  const words = source.split(/\s+/).filter(Boolean)

  const first = firstCharacter(words[0] ?? source)
  if (words.length < 2) return first.toUpperCase()

  return (first + firstCharacter(words[words.length - 1])).toUpperCase()
}

/**
 * The first character, counting by code point.
 *
 * `string[0]` returns half a surrogate pair for anything outside the
 * BMP — an emoji in a display name, or a rarer Han character — which
 * renders as a replacement box.
 */
function firstCharacter(word: string): string {
  return [...word][0] ?? ''
}

/**
 * A stable colour for the fallback avatar, chosen from the address.
 *
 * Keyed on the email rather than the name so it does not change when a
 * reader edits their display name — the point of the colour is that
 * your own avatar looks like *yours* every time you see it. The hues
 * avoid the 40–70° band, which collides with the site's accent brown.
 */
export function readerAvatarHue(identity: ReaderIdentity): number {
  let hash = 0
  for (const char of identity.email.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) % 100000
  }
  return (hash % 27) * 10 + 80
}
