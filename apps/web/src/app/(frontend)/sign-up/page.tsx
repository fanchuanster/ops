import { redirect } from 'next/navigation'
import React from 'react'

import { AuthForm } from '../../../components/AuthForm'
import { GoogleSignInButton } from '../../../components/GoogleSignInButton'
import { SIGNUP_GRANT } from '../../../domain/credits'
import { getCurrentUser, safeNext } from '../../../lib/auth'
import { isGoogleSignInConfigured } from '../../../lib/googleOAuth'
import { signUp } from '../actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create an account' }

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeNext(next)

  const user = await getCurrentUser()
  if (user) redirect(target)

  return (
    <main className="page auth-page">
      <p className="eyebrow">Join the library</p>
      <h1>Create an account</h1>
      <p className="auth-page__lede">
        Free, and always will be. New accounts start with {SIGNUP_GRANT} credits — credits pay
        only for sending a book to a device. Reading here costs nothing and never will.
      </p>

      <div className="auth-card">
        {isGoogleSignInConfigured() ? (
          <>
            <GoogleSignInButton next={target} label="Continue with Google" />
            <p className="auth-divider">
              <span>or</span>
            </p>
          </>
        ) : null}

        <AuthForm action={signUp} mode="signup" next={target} />
      </div>

      <p className="auth-page__alt">
        Already have one? <a href={`/login?next=${encodeURIComponent(target)}`}>Sign in</a>.
      </p>
    </main>
  )
}
