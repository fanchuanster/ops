import React from 'react'

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      decoding="async"
      className="brand-mark"
    />
  )
}
