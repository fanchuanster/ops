'use client'

import { useEffect } from 'react'

/** Whatever a server action hands back: a message, or a reason it failed. */
export interface SavedState {
  ok?: string
  error?: string
}

/**
 * Run something once, when a server action has actually succeeded.
 *
 * Every editing surface in the admin closes itself on a successful
 * save — the panels beside the Library and Readers lists, the inline
 * shelf form, the review queue's decision. An editor works down a list:
 * they finish with one thing and go to the next, so a form still
 * sitting open over the row they have finished with is a screen they
 * have to dismiss before they can see what they just did. The list
 * behind it already shows the change, which is the confirmation that
 * matters.
 *
 * A save that *fails* closes nothing. There is still something to do in
 * the form, and the error is written inside it.
 *
 * Two conditions, not one. `ok` alone is not enough because an action
 * can return both — a partial success with a warning — and `state`
 * starting empty is what keeps this from firing on mount.
 */
export function useOnSaved(state: SavedState, done: () => void) {
  useEffect(() => {
    if (state.ok && !state.error) done()
    // `done` is a fresh closure on every render, and depending on it
    // would re-run this whenever the parent re-renders — which for a
    // router.replace is harmless and for a setState is a loop. The
    // state is the event; the callback is only how it is handled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
}
