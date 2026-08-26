'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The reader for a book that is a plain text file.
 *
 * A text upload published as it stands has no EPUB and no PDF — it has
 * itself (`domain/publication.ts`). That is much less of a compromise
 * than the PDF case beside it: text *reflows*, which is the property
 * this whole project exists to give a scan. What it does not carry is
 * structure — no chapters, no contents, no page breaks — and that is
 * precisely what converting it adds, and why converting is still
 * offered.
 *
 * So this does one thing well: set the words in the reading typography
 * the site already has, with paragraphs where the file has blank lines.
 *
 * **Fetched in the browser, not rendered on the server.** A book is up
 * to 100 MB and a Worker has 128 MB for everything, so reading the file
 * into memory to build HTML from it is the one shape that cannot be
 * allowed. Streaming is I/O and stays cheap (CLAUDE.md section 14), so
 * the Worker streams and the browser — which has the memory and is
 * going to hold the text anyway — does the rest. It comes down the same
 * authorized route the EPUB does, so the bucket stays private and the
 * rights check still stands in front of every word.
 */
export function TextReader({
  url,
  bookTitle,
  subtitle,
  progressKey,
  lang,
}: {
  url: string
  bookTitle: string
  subtitle: string
  /** Where this reader's scroll position is remembered, per book. */
  progressKey: string
  /** The book's own language, so a browser sets it in the right font. */
  lang?: string
}) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        // Decoded as UTF-8 by the browser, from the charset the stream
        // declares. A text upload is required to be UTF-8 on the way in,
        // so there is no encoding to guess at here.
        return response.text()
      })
      .then((text) => {
        if (live) setParagraphs(splitParagraphs(text))
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [url])

  // Where they were last time, restored once the text is actually on the
  // page — before that there is nothing to scroll to. Stored as a
  // fraction rather than a pixel offset, because the same book is a
  // different height on a phone and on a laptop.
  useEffect(() => {
    if (!paragraphs || !stage.current) return
    try {
      const saved = Number(window.localStorage.getItem(progressKey))
      if (saved > 0 && saved < 1) {
        stage.current.scrollTop = saved * stage.current.scrollHeight
      }
    } catch {
      // A browser with site data blocked still reads the book, from the
      // top. Losing the position is not worth failing over.
    }
  }, [paragraphs, progressKey])

  const remember = () => {
    const element = stage.current
    if (!element || !element.scrollHeight) return
    try {
      window.localStorage.setItem(progressKey, String(element.scrollTop / element.scrollHeight))
    } catch {
      // As above.
    }
  }

  return (
    <div className="reader">
      <div className="reader__bar">
        <div className="reader__where">
          <strong>{bookTitle}</strong>
          <span>{subtitle}</span>
        </div>
      </div>

      <div className="reader__stage reader__stage--text" ref={stage} onScroll={remember}>
        {failed ? (
          <div className="reader__error">
            <p>This book could not be loaded.</p>
            <p className="hint">Try again, or send it to your e-reader from the book page.</p>
          </div>
        ) : paragraphs === null ? (
          <div className="reader__loading">Opening…</div>
        ) : (
          <article className="reader__text" lang={lang || undefined}>
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        )}
      </div>
    </div>
  )
}

/**
 * Blank lines separate paragraphs — the same rule the converter reads a
 * text file by (`services/converter/app/sources/text.py`), so a book
 * reads the same here as it will if somebody converts it later.
 *
 * With one exception, and it is the common shape for this library's
 * material: a file with **no** blank lines anywhere is one paragraph per
 * *line*, not one paragraph. Chinese texts are typed that way far more
 * often than not, and the general rule would render such a book as a
 * single unbroken block.
 *
 * Line breaks inside a paragraph are kept rather than collapsed — see
 * `white-space: pre-line` on `.reader__text p`. Verse is the reason:
 * a poem whose lines were joined into a sentence is no longer a poem.
 */
function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  if (blocks.length > 1) return blocks

  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
