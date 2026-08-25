import React from 'react'

/**
 * The gtag.js snippet, as Google gives it, in the server-rendered HTML.
 *
 * A **server** component with plain `<script>` tags, deliberately. This
 * was a client component using `next/script` with `afterInteractive`
 * until 2026-08-25, on the reasoning that a reading site should render
 * its text before a third party's measurement — which is right about
 * priorities and was wrong about what it did. Inside a client
 * component, `next/script` puts nothing executable in the document: the
 * server HTML carried a `<link rel="preload">` and a reference to the
 * component in the RSC payload, and the real tags were inserted by the
 * client runtime after hydration. Google's own tag detector fetches the
 * page and looks for the tag, so it reported the tag as missing, and it
 * was right — anything that reads HTML rather than running React saw no
 * analytics at all.
 *
 * `async` on the loader is what actually buys the priority the old
 * strategy was after, and it is what Google's snippet already said.
 *
 * The inline script comes first in source so `dataLayer` exists before
 * anything can push to it. React hoists the `async src` tag into
 * `<head>` regardless, which is where Google asks for it; inline
 * scripts are not hoisted and stay here.
 *
 * Interpolating `measurementId` into both is safe because it is not
 * free text: `analyticsMeasurementId` returns it only if it matches
 * `^G-[A-Z0-9]+$`, so nothing else can reach a script URL or a script
 * body through it.
 */
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
