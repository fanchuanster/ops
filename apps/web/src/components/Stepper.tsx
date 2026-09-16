import React from 'react'

import { UPLOAD_STEPS } from '../domain/pipeline'

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
