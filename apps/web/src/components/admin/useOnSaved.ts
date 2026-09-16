'use client'

import { useEffect } from 'react'

export interface SavedState {
  ok?: string
  error?: string
}

export function useOnSaved(state: SavedState, done: () => void) {
  useEffect(() => {
    if (state.ok && !state.error) done()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
}
