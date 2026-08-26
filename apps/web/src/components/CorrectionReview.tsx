'use client'

import { useActionState, useMemo, useState } from 'react'

import {
  recordDecisions,
  requestCorrection,
  type CorrectionActionState,
} from '../app/(frontend)/actions/correction'
import {
  type CorrectionState,
  type Suggestion,
  awaitingDecision,
  correctionInFlight,
  suggestionId,
} from '../domain/correction'

/**
 * The human half of AI correction.
 *
 * CLAUDE.md section 7 asks for *original + suggestion + reason +
 * confidence + human approval*, and this is the screen where the last
 * of those happens. Every element of it is deliberate:
 *
 * **Nothing is ticked to begin with.** A pre-ticked list is a consent
 * dialogue pretending to be a review — the reader would be approving
 * whatever they failed to read. Adopting is an action; declining is the
 * default and costs nothing.
 *
 * **The original is shown, always, beside the proposal.** A suggestion
 * without its before-text asks the reader to trust the model, which is
 * exactly what this stage exists not to do.
 *
 * **The model's reason is shown as the model's**, not as a finding. It
 * proposed a change and said why; whether that is true about this book
 * is the reader's judgement, and the phrasing must not borrow authority
 * it does not have.
 */

const CATEGORY_LABELS: Record<string, string> = {
  characters: 'Wording',
  punctuation: 'Punctuation',
}

/** Only two are meaningful; anything else is shown as the converter named it. */
function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

function Diff({ suggestion }: { suggestion: Suggestion }) {
  return (
    <div className="suggestion__diff">
      <p className="suggestion__line suggestion__line--was cjk">
        <span className="suggestion__tag">Printed</span>
        {suggestion.original}
      </p>
      <p className="suggestion__line suggestion__line--now cjk">
        <span className="suggestion__tag">Proposed</span>
        {suggestion.suggested}
      </p>
    </div>
  )
}

export function CorrectionReview({
  bookId,
  state,
  suggestions,
  count,
  adopted,
  message,
  canRequest,
}: {
  bookId: number
  state: CorrectionState
  suggestions: Suggestion[]
  count?: number | null
  adopted?: number | null
  message?: string | null
  canRequest: boolean
}) {
  const [decide, decideAction, deciding] = useActionState<CorrectionActionState, FormData>(
    recordDecisions,
    {},
  )
  const [request, requestAction, requesting] = useActionState<CorrectionActionState, FormData>(
    requestCorrection,
    {},
  )

  // Ticked ids, so the count in the button is honest before submitting.
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const ids = useMemo(() => suggestions.map((s) => suggestionId(s)), [suggestions])

  const toggle = (id: string) =>
    setChosen((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const notice = decide.error ?? request.error ?? decide.ok ?? request.ok
  const bad = Boolean(decide.error ?? request.error)

  return (
    <section className="correction">
      <h3>AI-suggested corrections</h3>

      {notice ? <p className={bad ? 'form-error' : 'form-ok'}>{notice}</p> : null}

      {correctionInFlight(state) ? (
        <p className="hint">
          {state === 'running'
            ? 'Reading the book and proposing corrections. This page will show them when they are ready.'
            : 'Applying what you adopted, and rebuilding the reading edition from the corrected master.'}
        </p>
      ) : null}

      {state === 'failed' ? (
        <p className="hint">
          The last attempt did not finish{message ? `: ${message}` : '.'}
        </p>
      ) : null}

      {state === 'applied' ? (
        <p className="hint">
          {adopted
            ? `${adopted} ${adopted === 1 ? 'correction was' : 'corrections were'} applied to the master.`
            : 'Nothing was adopted, so the book is unchanged.'}
        </p>
      ) : null}

      {state === 'pending' ? (
        <p className="hint">
          Queued. A converter will read the master and propose corrections; they will appear
          here for you to decide on.
        </p>
      ) : null}

      {awaitingDecision(state) && suggestions.length === 0 ? (
        <p className="hint">
          The model read the book and proposed nothing. For a clean text that is the expected
          outcome, not a failure.
        </p>
      ) : null}

      {awaitingDecision(state) && suggestions.length > 0 ? (
        <form action={decideAction}>
          <input type="hidden" name="bookId" value={bookId} />
          <p className="hint">
            {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'} for
            your book{typeof count === 'number' && count !== suggestions.length
              ? ` (of ${count} proposed)`
              : ''}
            . Nothing changes unless you adopt it. Anything you leave unticked is declined.
          </p>

          <ul className="suggestion-list">
            {suggestions.map((suggestion) => {
              const id = suggestionId(suggestion)
              return (
                <li key={id} className="suggestion">
                  <label className="suggestion__adopt">
                    <input
                      type="checkbox"
                      name="adopt"
                      value={id}
                      checked={chosen.has(id)}
                      onChange={() => toggle(id)}
                    />
                    <span>Adopt</span>
                  </label>
                  <div className="suggestion__body">
                    <Diff suggestion={suggestion} />
                    <p className="suggestion__why">
                      <span className="suggestion__badge">{categoryLabel(suggestion.category)}</span>
                      {suggestion.reason ? (
                        <span className="suggestion__reason">
                          The model’s reason: {suggestion.reason}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="suggestion-actions">
            <button className="cta" type="submit" disabled={deciding}>
              {deciding
                ? 'Saving…'
                : chosen.size === 0
                  ? 'Decline everything'
                  : `Adopt ${chosen.size} of ${ids.length}`}
            </button>
            {chosen.size > 0 ? (
              <button
                className="cta cta--compact"
                type="button"
                onClick={() => setChosen(new Set())}
                disabled={deciding}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="hint">
            Adopting rewrites those lines in the DOCX master and rebuilds the reading edition
            from it. The original file you uploaded is never touched.
          </p>
        </form>
      ) : null}

      {canRequest ? (
        <form action={requestAction} className="suggestion-actions">
          <input type="hidden" name="bookId" value={bookId} />
          <button className="cta cta--compact" type="submit" disabled={requesting}>
            {requesting
              ? 'Queueing…'
              : state === 'applied' || state === 'failed'
                ? 'Propose corrections again'
                : 'Propose corrections'}
          </button>
        </form>
      ) : null}
    </section>
  )
}
