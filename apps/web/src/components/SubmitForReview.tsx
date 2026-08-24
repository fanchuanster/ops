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

/**
 * Asking for a converted book to join the public library.
 *
 * Offered only on a finished book, and only as an option — a private
 * upload may stay private forever, which is the normal case and not the
 * lesser one. The rights answer is required here and nowhere else,
 * because this is the only point at which it matters; it moved off the
 * details form on 2026-08-21 for exactly that reason.
 *
 * Two questions are asked, and they are different in kind. Where the
 * book came from is a fact only the uploader has, and the answer
 * decides whether publication is possible at all. Where it belongs in
 * the library is a judgement — theirs is worth having, because nobody
 * has read this book more recently, but it is a *suggestion* and the
 * form says so plainly rather than implying a promise an editor may not
 * keep.
 *
 * The question is put plainly and the consequences are shown as notes
 * rather than warnings. Two of the five answers cannot lead to
 * publication, and neither is a rejection of the book: an uploader who
 * owns a copy, or does not know where their scan came from, still gets
 * the EPUB, still reads it here, and still sends it to their own
 * device. Only the public library is closed to them, and saying so
 * calmly is the difference between a legal gate and an accusation.
 */

/** The answer that means "no answer" — stored as `unknown` rights. */
const NOT_SURE = 'not_sure'

const NOTES: Record<string, string> = {
  user_owned:
    'Owning a copy is not the right to publish it to everyone else, so this one stays private. You can still read it here and send it to your own device.',
  [NOT_SURE]:
    'We cannot publish a book whose rights are unknown. You can still read it here and send it to your own device — and if you find out where it came from, you can submit it then.',
}

/** The five options, in the design's order: clearest answer first. */
const OPTIONS = [
  ...UPLOADER_RIGHTS.map((option) => ({ value: option.value as string, label: option.label })),
  { value: NOT_SURE, label: 'I’m not sure' },
]

/** Where a submitted book is, and what is still ahead of it. */
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
  /** What the book currently says about where it came from. */
  rightsStatus: string
  /** The editor's words, on an approved or rejected book. */
  reviewNote?: string | null
  /** The level id this uploader suggested last time, if they did. */
  proposedLevel?: number | null
  /**
   * Whether the uploader looking at this is an administrator.
   *
   * They are both parties to their own book's review, so this form
   * publishes rather than queues — the words change to say so, because a
   * button labelled "submit for review" that puts a book in front of
   * everybody is a button that lies.
   */
  byAdmin?: boolean
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(submitForReview, {})

  // Pre-selected from what the book already says, so a reader who
  // answered once and came back is not asked again.
  //
  // A book that says nothing — `unknown`, which is what every upload
  // starts as — falls to public domain. Nothing was pre-selected until
  // 2026-08-24, on the reasoning that an answer nobody gave is worse
  // than no answer; what that produced in practice was a form where the
  // submit button was dead on arrival and the commonest true answer for
  // this library's material took an extra click every time.
  //
  // It is still an answer the uploader has to leave standing, and it is
  // still only a declaration: `isPubliclyDistributable` decides what
  // may be published, an administrator reads the declaration before
  // approving, and neither is affected by which radio arrived checked.
  const [chosen, setChosen] = useState<string>(
    OPTIONS.some((option) => option.value === rightsStatus)
      ? rightsStatus
      : UPLOADER_RIGHTS[0].value,
  )

  // Always one of the three. "No preference — you decide" was a fourth
  // radio and the default until 2026-08-24; it is gone, and the level
  // falls to the library's own default instead.
  //
  // Removing it costs nothing real. The field was always a suggestion
  // an editor is free to ignore — `approveSubmission` does not apply
  // it, and `domain/moderation.ts` keeps `level` an administrator field
  // precisely so that asking is not deciding. So the choice between
  // "no preference" and "normal" was a distinction only this form drew.
  //
  // A previous proposal is read back so someone resubmitting after a
  // rejection is not asked to remember what they said.
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
        {/* No timeline here. Every step of it is a tick on an approved
            book, and a progress list with nothing left to progress
            through says less than the heading above it already does. */}
        {reviewNote ? (
          <div className="editor-note">
            <strong>Editor’s note</strong>
            <p>{reviewNote}</p>
          </div>
        ) : null}
      </section>
    )
  }

  // Chosen but cannot be published. Not an error and not a refusal of
  // the book — the note says what is still true of it.
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
                  // `not_sure` is not a rights status, so it is not
                  // posted. An empty value leaves the book at `unknown`,
                  // which is what "I'm not sure" means — and the server
                  // gate refuses it on its own.
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

        {/* The same fieldset shape as the question above, deliberately:
            these are two parts of one submission and looking alike is
            how that reads. */}
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
