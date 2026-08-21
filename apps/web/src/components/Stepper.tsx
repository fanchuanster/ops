import React from 'react'

import { UPLOAD_STEPS } from '../domain/pipeline'

/**
 * Where a book is in the conversion flow: Upload → Process → Review →
 * Publish.
 *
 * A server component with no state — the step is derived from the book
 * (`uploadStep` in `domain/pipeline.ts`) and rendered once. The design
 * puts this above every screen of the flow, and it earns its place by
 * answering the question the individual sections cannot: how much of
 * this is left.
 *
 * An ordered list rather than a row of divs, because that is what it
 * is, and `aria-current="step"` marks the one you are on — a stepper
 * drawn purely in colour says nothing to a reader who cannot see it.
 */
export function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper">
      {UPLOAD_STEPS.map((label, index) => {
        const done = index < step
        const current = index === step
        return (
          <li
            key={label}
            className={`stepper__step${done ? ' stepper__step--done' : ''}${
              current ? ' stepper__step--current' : ''
            }`}
            aria-current={current ? 'step' : undefined}
          >
            <span className="stepper__mark" aria-hidden="true">
              {done ? '✓' : index + 1}
            </span>
            <span className="stepper__label">{label}</span>
            {index < UPLOAD_STEPS.length - 1 ? (
              <span className="stepper__line" aria-hidden="true" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
