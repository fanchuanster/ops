'use client'

import { useEffect, useRef, useState } from 'react'

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
  progressKey: string
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

  useEffect(() => {
    if (!paragraphs || !stage.current) return
    try {
      const saved = Number(window.localStorage.getItem(progressKey))
      if (saved > 0 && saved < 1) {
        stage.current.scrollTop = saved * stage.current.scrollHeight
      }
    } catch {
    }
  }, [paragraphs, progressKey])

  const remember = () => {
    const element = stage.current
    if (!element || !element.scrollHeight) return
    try {
      window.localStorage.setItem(progressKey, String(element.scrollTop / element.scrollHeight))
    } catch {
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
