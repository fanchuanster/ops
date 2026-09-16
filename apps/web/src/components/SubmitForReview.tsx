'use client'

import { useActionState, useState } from 'react'

import { submitForReview, type DetailsState } from '../app/(frontend)/actions/bookDetails'
import {
  BOOK_LEVELS,
  DEFAULT_BOOK_LEVEL,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  levelFromId,
  type BookLevel,
} from '../domain/levels'
import { UPLOADER_RIGHTS, isPubliclyDistributable, type RightsStatus } from '../domain/rights'

const NOT_SURE = 'not_sure'

const NOTES: Record<string, string> = {
  user_owned:
    'Owning a copy is not the right to publish it to everyone else, so this one stays private. You can still read it here and send it to your own device.',
  [NOT_SURE]:
    'We cannot publish a book whose rights are unknown. You can still read it here and send it to your own device — and if you find out where it came from, you can submit it then.',
}

const OPTIONS = [
  ...UPLOADER_RIGHTS.map((option) => ({ value: option.value as string, label: option.label })),
  { value: NOT_SURE, label: 'I’m not sure' },
]

function Timeline({ reached }: { reached: number }) {
  const steps = ['Uploaded', 'Editions built', 'Submitted for review', 'Editor’s decision', 'Published']

  return (
    <ol className="timeline">
      {steps.map((label, index) => {
        const done = index < reached
        return (
          <li key={label} data-done={done}>
            <span className="timeline__rail" aria-hidden="true">
              <span className="timeline__dot">{done ? '✓' : ''}</span>
              {index < steps.length - 1 ? <span className="timeline__line" /> : null}
            </span>
            <span className="timeline__label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function SubmitForReview({
  bookId,
  reviewState,
  rightsStatus,
  reviewNote,
  proposedLevel,
  byAdmin = false,
}: {
  bookId: number
  reviewState: string
  rightsStatus: string
  reviewNote?: string | null
  proposedLevel?: number | null
  byAdmin?: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(submitForReview, {})

  const [chosen, setChosen] = useState<string>(
    OPTIONS.some((option) => option.value === rightsStatus)
      ? rightsStatus
      : UPLOADER_RIGHTS[0].value,
  )

  const [level, setLevel] = useState<BookLevel>(
    proposedLevel ? levelFromId(proposedLevel) : DEFAULT_BOOK_LEVEL,
  )

  if (reviewState === 'submitted') {
    return (
      <section className="submit-review">
        <h3>Under review</h3>
        <p className="hint">
          An editor will read it. This can take a while — your book is readable by you in the
          meantime, and nothing about it changes while you wait.
        </p>
        {proposedLevel ? (
          <p className="hint">
            You suggested it belongs in <strong>{LEVEL_LABELS[levelFromId(proposedLevel)]}</strong>.
            The editor decides where it lands.
          </p>
        ) : null}
        <Timeline reached={3} />
      </section>
    )
  }

  if (reviewState === 'approved') {
    return (
      <section className="submit-review">
        <h3>Approved for the public library</h3>
        {reviewNote ? (
          <div className="editor-note">
            <strong>Editor’s note</strong>
            <p>{reviewNote}</p>
          </div>
        ) : null}
      </section>
    )
  }

  const blocked =
    chosen !== '' && (chosen === NOT_SURE || !isPubliclyDistributable(chosen as RightsStatus))

  return (
    <section className="submit-review">
      <h3>{reviewState === 'rejected' ? 'Changes requested' : 'Share it with everyone?'}</h3>

      {reviewState === 'rejected' ? (
        <>
          <p className="hint">
            An editor read it and asked for a change before it joins the public library. Correct
            the master above and submit it again — this is a normal step, not a verdict.
          </p>
          {reviewNote ? (
            <div className="editor-note">
              <strong>Editor’s note</strong>
              <p>{reviewNote}</p>
            </div>
          ) : null}
        </>
      ) : byAdmin ? (
        <p className="hint">
          Optional. Keeping it private changes nothing about how it works for you. You are an
          administrator, so this publishes the book rather than queueing it — the rights answer
          below still decides, exactly as it would for anyone else.
        </p>
      ) : (
        <p className="hint">
          Optional. Keeping it private changes nothing about how it works for you. Submitting asks
          an administrator to consider it for the public library.
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="bookId" value={bookId} />

        <fieldset className="rights">
          <p>Where did this book come from?</p>
          <p className="rights__hint">Required to submit to the library.</p>

          <div className="rights__options">
            {OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={option.value === NOT_SURE ? 'rightsUnsure' : 'rightsStatus'}
                  value={option.value === NOT_SURE ? '1' : option.value}
                  checked={chosen === option.value}
                  onChange={() => setChosen(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          {NOTES[chosen] ? <p className="rights__note">{NOTES[chosen]}</p> : null}
        </fieldset>

        <fieldset className="rights">
          <p>Where does it belong in the library?</p>
          <p className="rights__hint">
            {byAdmin
              ? 'You are the editor, so set it here or from the library screen.'
              : 'Only a suggestion — an editor decides where it sits.'}
          </p>

          <div className="rights__options">
            {BOOK_LEVELS.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="proposedLevel"
                  value={option}
                  checked={level === option}
                  onChange={() => setLevel(option)}
                />
                <span>
                  <strong>{LEVEL_LABELS[option]}</strong> — {LEVEL_DESCRIPTIONS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" className="cta" disabled={pending || chosen === '' || blocked}>
          {pending
            ? byAdmin
              ? 'Publishing…'
              : 'Submitting…'
            : byAdmin
              ? 'Publish to the library'
              : 'Submit to the public library'}
        </button>

        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    </section>
  )
}
