import React from 'react'

import { readerAvatarHue, readerInitials, type ReaderIdentity } from '../domain/avatar'

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
