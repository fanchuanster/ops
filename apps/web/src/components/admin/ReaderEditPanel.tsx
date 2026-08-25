'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { saveReader, type ReaderState } from '../../app/(admin)/actions/readers'

/**
 * The panel beside the Readers list, where an account is changed.
 *
 * Two fields, and the panel is mostly what it *cannot* change: credits,
 * uploads and join date are shown as facts, because they are facts —
 * each is derived or ledgered elsewhere and a form that could type over
 * one would be a second answer to a question already answered. See
 * `actions/readers.ts` for why each is out.
 *
 * Selection is `?reader=` in the URL, as `?book=` is on the Library
 * screen: it renders on the server, survives a save, gives every row a
 * real link, and leaves the only client state as the unsaved draft.
 *
 * The role checkbox disables itself on your own account. The action
 * refuses self-demotion regardless — a disabled input is a courtesy,
 * not a control — but a checkbox you can tick that always fails is
 * worse than one you cannot.
 */

export interface ReaderEditValues {
  id: number
  email: string
  displayName: string
  isAdmin: boolean
  credits: number
  uploads: number
  published: number
  joined: string
}

export function ReaderEditPanel({
  reader,
  isSelf,
  closeHref,
}: {
  reader: ReaderEditValues
  /** Whether this is the signed-in administrator's own account. */
  isSelf: boolean
  closeHref: string
}) {
  const [state, save, saving] = useActionState<ReaderState, FormData>(saveReader, {})

  const [draft, setDraft] = useState(reader)
  const [openedAs, setOpenedAs] = useState(reader)
  if (openedAs.id !== reader.id) {
    setOpenedAs(reader)
    setDraft(reader)
  }

  const dirty = draft.email !== reader.email || draft.isAdmin !== reader.isAdmin
  const name = reader.displayName || reader.email

  return (
    <aside className="admin-panel">
      <header className="admin-panel__head">
        <div className="admin-bookcell">
          <span className="admin-avatar" aria-hidden="true">
            {Array.from(name.trim())[0] ?? '·'}
          </span>
          <span>
            <h2>{name}</h2>
            <p className="admin-panel__meta">
              {reader.isAdmin ? (
                <span className="admin-chip-status admin-chip-status--approved">Admin</span>
              ) : (
                <span className="admin-quiet">Reader</span>
              )}
              <span className="admin-quiet">joined {reader.joined}</span>
            </p>
          </span>
        </div>
        <Link className="admin-panel__close" href={closeHref} scroll={false} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </header>

      <form action={save} className="admin-panel__body admin-fields">
        <input type="hidden" name="readerId" value={reader.id} />

        <div className="admin-field">
          <label htmlFor="reader-email">Email</label>
          <input
            id="reader-email"
            name="email"
            type="email"
            value={draft.email}
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          <p className="admin-hint">
            This is what they sign in with. Correcting a typo here changes who can
            get into the account — it does not notify them, and it does not unlink
            a Google sign-in.
          </p>
        </div>

        <div className="admin-field">
          <label className="admin-check">
            <input
              type="checkbox"
              name="isAdmin"
              checked={draft.isAdmin}
              disabled={isSelf}
              onChange={(event) => setDraft({ ...draft, isAdmin: event.target.checked })}
            />
            <span>Administrator</span>
          </label>
          <p className="admin-hint">
            {isSelf
              ? 'This is you. Withdrawing your own role is refused — somebody has to be able to grant it back.'
              : 'Reviews and publishes submissions, curates the library, and manages accounts.'}
          </p>
        </div>

        <dl className="admin-facts">
          <div>
            <dt>Credits</dt>
            <dd>{reader.credits}</dd>
          </div>
          <div>
            <dt>Uploads</dt>
            <dd>{reader.uploads}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>{reader.published}</dd>
          </div>
        </dl>

        <div className="admin-panel__actions">
          <button type="submit" className="admin-btn admin-btn--publish" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty ? (
            <button
              type="button"
              className="admin-linkbtn"
              onClick={() => setDraft(reader)}
              disabled={saving}
            >
              Discard
            </button>
          ) : null}
        </div>

        {state.error ? <p className="form-error">{state.error}</p> : null}
        {state.ok && !dirty ? <p className="admin-ok">{state.ok}</p> : null}
      </form>
    </aside>
  )
}
