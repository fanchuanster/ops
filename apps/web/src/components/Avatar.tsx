import React from 'react'

import { readerAvatarHue, readerInitials, type ReaderIdentity } from '../domain/avatar'

/**
 * A reader's face, or the next best thing.
 *
 * Google gives us a picture; a reader who registered with a password
 * gives us nothing, and gets initials on a colour derived from their
 * address. The fallback is deliberately not a generic grey silhouette —
 * the point of a face in a header is to tell you at a glance *which*
 * account you are in, and every silhouette looks like every other one.
 *
 * No `next/image`: these are third-party URLs on a Worker, where the
 * optimizer would mean proxying and re-encoding someone's avatar on
 * every cold start for a 32px circle.
 */
export function Avatar({
  identity,
  size = 28,
}: {
  identity: ReaderIdentity
  size?: number
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }

  if (identity.avatarUrl) {
    return (
      <img
        className="avatar"
        style={style}
        src={identity.avatarUrl}
        alt=""
        width={size}
        height={size}
        // Always one of our own paths — `/avatar?v=…`, served by the
        // route of the same name from bytes mirrored into R2 at
        // sign-in. Google's URL is never rendered, so loading the page
        // does not tell Google the reader is here. See lib/avatars.ts.
        //
        // Decorative: the name sits next to it, so a screen reader
        // announcing "image" here would only add noise.
        aria-hidden="true"
      />
    )
  }

  return (
    <span
      className="avatar avatar--initials"
      style={{ ...style, background: `hsl(${readerAvatarHue(identity)} 32% 42%)` }}
      aria-hidden="true"
    >
      {readerInitials(identity)}
    </span>
  )
}
