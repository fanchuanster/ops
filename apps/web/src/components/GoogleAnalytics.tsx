import React from 'react'

export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`,
        }}
      />
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} />
    </>
  )
}
