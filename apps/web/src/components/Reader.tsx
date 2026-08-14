'use client'

import ePub, { type Book, type Rendition } from 'epubjs'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The in-browser reflowable reader.
 *
 * This is the product thesis made concrete: the same text the reader
 * could only pan around in a scanned PDF, reflowed and under their
 * control. Everything exposed here — size, spacing, measure, theme — is
 * a knob a paper book doesn't have and a scan actively denies.
 *
 * epub.js renders into an iframe it owns, so the page's own stylesheet
 * cannot reach the text. Themes are registered with epub.js instead,
 * and re-registered whenever the settings change.
 */

const FONT_SIZES = [90, 100, 112, 125, 140, 160, 185] as const
const SPACING = { snug: 1.5, normal: 1.75, loose: 2.1 } as const

type SpacingKey = keyof typeof SPACING

interface Settings {
  fontIndex: number
  spacing: SpacingKey
  serif: boolean
  measure: boolean
}

const DEFAULTS: Settings = { fontIndex: 1, spacing: 'normal', serif: true, measure: true }

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem('noblesee-reader')
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function Reader({
  epubUrl,
  bookTitle,
  partTitle,
  progressKey,
}: {
  epubUrl: string
  bookTitle: string
  partTitle: string
  progressKey: string
}) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)

  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chapter, setChapter] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => setSettings(loadSettings()), [])

  const applyTheme = useCallback((rendition: Rendition, s: Settings) => {
    const dark =
      document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)

    rendition.themes.register('noblesee', {
      body: {
        background: dark ? '#14120f' : '#fbf9f4',
        color: dark ? '#e8e3d9' : '#23201b',
        'font-family': s.serif
          ? '"Noto Serif TC", "Source Han Serif TC", "Songti TC", Georgia, serif'
          : '"Noto Sans TC", "PingFang TC", system-ui, sans-serif',
        'line-height': String(SPACING[s.spacing]),
        // A measure cap is the single biggest legibility win on a wide
        // screen: without it lines run the full window width and the
        // eye loses its place returning to the left margin.
        'max-width': s.measure ? '34rem' : 'none',
        margin: '0 auto',
        padding: '0 1.25rem',
      },
      p: { 'text-align': 'justify', 'text-justify': 'inter-ideograph' },
      a: { color: dark ? '#c9a227' : '#7a5c2e' },
      'h1, h2, h3': { 'line-height': '1.35' },
    })
    rendition.themes.select('noblesee')
    rendition.themes.fontSize(`${FONT_SIZES[s.fontIndex]}%`)
  }, [])

  // Mount the book once. Settings changes re-theme the existing
  // rendition rather than tearing it down, so the reader's position is
  // never lost by nudging the font size.
  useEffect(() => {
    if (!viewerRef.current) return

    // `openAs` is not optional here, however redundant it looks.
    //
    // Given a bare URL, epub.js guesses what it is *from the file
    // extension* (`determineType` in epubjs/src/book.js). Our URL is
    // `/read/<slug>/<order>/epub` — authorization is a route, not a
    // file, so there is no `.epub` on the end. epub.js reads the empty
    // extension as `DIRECTORY` and goes looking for
    // `/read/<slug>/<order>/epub/META-INF/container.xml`, which is a
    // 404.
    //
    // What made this hard to see is how it fails. epub.js catches that
    // rejection, emits `openFailed` and swallows it, so `book.opened`
    // never settles — `display()` below neither resolves nor rejects,
    // and the page sits on "Opening…" with an empty frame forever. No
    // error, no console message, no content.
    const book = ePub(epubUrl, { openAs: 'epub' })
    bookRef.current = book

    // Belt and braces for the above: anything that stops the book
    // opening should reach the reader as a message rather than as an
    // empty page that never resolves.
    book.on('openFailed', () => setError('This edition could not be opened.'))

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
    })
    renditionRef.current = rendition

    const saved = localStorage.getItem(progressKey)
    rendition
      .display(saved || undefined)
      .then(() => setReady(true))
      .catch(() => setError('This edition could not be opened.'))

    rendition.on('relocated', (location: { start: { cfi: string; href: string } }) => {
      localStorage.setItem(progressKey, location.start.cfi)
      const item = book.navigation?.toc?.find((t) => location.start.href.includes(t.href))
      if (item) setChapter(item.label.trim())
    })

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') rendition.next()
      if (event.key === 'ArrowLeft') rendition.prev()
    }
    window.addEventListener('keydown', onKey)
    rendition.on('keyup', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      rendition.destroy()
      book.destroy()
    }
  }, [epubUrl, progressKey])

  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, settings)
  }, [settings, applyTheme, ready])

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    localStorage.setItem('noblesee-reader', JSON.stringify(next))
  }

  if (error) {
    return (
      <div className="reader__error">
        <p>{error}</p>
        <p className="hint">The EPUB download on the book page may still work.</p>
      </div>
    )
  }

  return (
    <div className="reader">
      <div className="reader__bar">
        <div className="reader__where">
          <strong>{bookTitle}</strong>
          <span>{chapter || partTitle}</span>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
        >
          Aa
        </button>
      </div>

      {panelOpen ? (
        <div className="reader__settings" role="group" aria-label="Reading settings">
          <div className="reader__setting">
            <span>Text size</span>
            <div className="reader__buttons">
              <button
                type="button"
                onClick={() => update({ fontIndex: Math.max(0, settings.fontIndex - 1) })}
                disabled={settings.fontIndex === 0}
                aria-label="Smaller text"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() =>
                  update({ fontIndex: Math.min(FONT_SIZES.length - 1, settings.fontIndex + 1) })
                }
                disabled={settings.fontIndex === FONT_SIZES.length - 1}
                aria-label="Larger text"
              >
                A+
              </button>
            </div>
          </div>

          <div className="reader__setting">
            <span>Line spacing</span>
            <div className="reader__buttons">
              {(Object.keys(SPACING) as SpacingKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update({ spacing: key })}
                  aria-pressed={settings.spacing === key}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <div className="reader__setting">
            <span>Typeface</span>
            <div className="reader__buttons">
              <button
                type="button"
                onClick={() => update({ serif: true })}
                aria-pressed={settings.serif}
              >
                Serif
              </button>
              <button
                type="button"
                onClick={() => update({ serif: false })}
                aria-pressed={!settings.serif}
              >
                Sans
              </button>
            </div>
          </div>

          <div className="reader__setting">
            <span>Line width</span>
            <div className="reader__buttons">
              <button
                type="button"
                onClick={() => update({ measure: true })}
                aria-pressed={settings.measure}
              >
                Comfortable
              </button>
              <button
                type="button"
                onClick={() => update({ measure: false })}
                aria-pressed={!settings.measure}
              >
                Full width
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="reader__stage">
        <button
          type="button"
          className="reader__page reader__page--prev"
          onClick={() => renditionRef.current?.prev()}
          aria-label="Previous page"
        >
          ‹
        </button>
        <div className="reader__viewer" ref={viewerRef} />
        <button
          type="button"
          className="reader__page reader__page--next"
          onClick={() => renditionRef.current?.next()}
          aria-label="Next page"
        >
          ›
        </button>
      </div>

      {!ready ? <p className="reader__loading">Opening…</p> : null}
    </div>
  )
}
