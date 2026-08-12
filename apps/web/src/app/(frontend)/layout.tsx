import React from 'react'

export const metadata = {
  title: 'NobleSee',
  description: 'Books worth reading, made comfortable to read.',
}

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
