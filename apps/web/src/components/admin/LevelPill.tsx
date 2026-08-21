'use client'

import { useActionState } from 'react'

import { setBookLevel, type LibraryState } from '../../app/(admin)/actions/library'
import { BOOK_LEVELS, LEVEL_DESCRIPTIONS, LEVEL_LABELS, type BookLevel } from '../../domain/levels'

/**
 * A book's reading level, as three buttons.
 *
 * The design shows E / N / E — one initial each — which is right for a
 * dense table and wrong for anyone who cannot see the colour that
 * distinguishes them. So the initial is decorative and the accessible
 * name is the whole label plus what it means, which is also the title
 * a mouse gets. Three initials in a row where two of them are "E" is
 * not a control anybody can read cold.
 *
 * One form per button rather than a select: the level is a choice
 * between three visible options, and a click that saves immediately is
 * the interaction the design draws. `useActionState` is here for the
 * error, which otherwise has nowhere to go.
 */
export function LevelPill({ bookId, level }: { bookId: number; level: BookLevel }) {
  const [state, act, pending] = useActionState<LibraryState, FormData>(setBookLevel, {})

  return (
    <form action={act} className="admin-level" title={state.error ?? undefined}>
      <input type="hidden" name="bookId" value={bookId} />
      {BOOK_LEVELS.map((option) => (
        <button
          key={option}
          type="submit"
          name="level"
          value={option}
          disabled={pending}
          className={`admin-level__pill admin-level__pill--${option}`}
          aria-pressed={option === level}
          data-on={option === level ? 'true' : undefined}
          title={`${LEVEL_LABELS[option]} — ${LEVEL_DESCRIPTIONS[option]}`}
        >
          <span aria-hidden="true">{LEVEL_LABELS[option][0]}</span>
          <span className="visually-hidden">{LEVEL_LABELS[option]}</span>
        </button>
      ))}
      {state.error ? <span className="visually-hidden">{state.error}</span> : null}
    </form>
  )
}
