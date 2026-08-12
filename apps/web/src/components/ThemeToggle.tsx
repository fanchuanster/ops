'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }

/**
 * Three-state theme control: system, light, dark.
 *
 * "System" is a real state rather than an absent one, so a reader whose
 * OS flips to dark at sunset keeps following it unless they say
 * otherwise. The chosen value is written to <html data-theme> and to
 * localStorage; the inline script in the layout replays it before first
 * paint so the page never flashes the wrong background.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  // Read the already-applied value rather than assuming a default:
  // the pre-paint script has run by now and is the source of truth.
  useEffect(() => {
    const applied = document.documentElement.dataset.theme
    setTheme(applied === 'light' || applied === 'dark' ? applied : 'system')
  }, [])

  const change = () => {
    const next = NEXT[theme]
    setTheme(next)
    if (next === 'system') {
      delete document.documentElement.dataset.theme
      localStorage.removeItem('noblesee-theme')
    } else {
      document.documentElement.dataset.theme = next
      localStorage.setItem('noblesee-theme', next)
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={change}
      aria-label={`Reading theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}.`}
    >
      {LABEL[theme]}
    </button>
  )
}
