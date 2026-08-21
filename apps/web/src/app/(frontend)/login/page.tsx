import { redirect } from 'next/navigation'
import React from 'react'

import { AuthForm } from '../../../components/AuthForm'
import { GoogleSignInButton } from '../../../components/GoogleSignInButton'
import { getCurrentUser, safeNext } from '../../../lib/auth'
import { isGoogleSignInConfigured } from '../../../lib/googleOAuth'
import { login } from '../actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams
  const target = safeNext(next)

  const user = await getCurrentUser()
  if (user) redirect(target)

  return (
    <main className="page auth-page">
      <p className="eyebrow">Welcome back</p>
      <h1>Sign in</h1>
      <p className="auth-page__lede">
        Reading is free and needs no account. Signing in is for sending a book to your e-reader,
        for the credits that pay for it, and for the books you upload yourself.
      </p>

      <div className="auth-card">
        {error ? (
          <p className="auth-form__error" role="alert">
            {error}
          </p>
        ) : null}

        {isGoogleSignInConfigured() ? (
          <>
            <GoogleSignInButton next={target} label="Continue with Google" />
            <p className="auth-divider">
              <span>or</span>
            </p>
          </>
        ) : null}

        <AuthForm action={login} mode="login" next={target} />
      </div>

      <p className="auth-page__alt">
        No account yet?{' '}
        <a href={`/sign-up?next=${encodeURIComponent(target)}`}>Create one</a>.
      </p>
    </main>
  )
}
