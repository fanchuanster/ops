'use client'

import { useActionState } from 'react'

import type { AuthState } from '../app/(frontend)/actions/auth'

/**
 * Shared shell for the log-in and sign-up forms.
 *
 * A client component only because it renders the pending state and the
 * server action's error message; the credentials themselves are handled
 * entirely in the action.
 */
export function AuthForm({
  action,
  mode,
  next,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
  mode: 'login' | 'signup'
  next: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  const isSignUp = mode === 'signup'

  return (
    <form action={formAction} className="auth-form">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className="auth-form__error" role="alert">
          {state.error}
        </p>
      ) : null}

      {isSignUp ? (
        <label>
          Name <span className="optional">(optional)</span>
          <input name="displayName" type="text" autoComplete="name" />
        </label>
      ) : null}

      <label>
        Email
        <input name="email" type="email" required autoComplete="email" autoFocus />
      </label>

      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={isSignUp ? 8 : undefined}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
        />
        {isSignUp ? <span className="hint">At least 8 characters.</span> : null}
      </label>

      <button type="submit" disabled={pending}>
        {pending ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}
