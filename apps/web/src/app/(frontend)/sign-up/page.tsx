import { redirect } from 'next/navigation'
import React from 'react'

import { AuthForm } from '../../../components/AuthForm'
import { getCurrentUser, safeNext } from '../../../lib/auth'
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
      <h1>Create an account</h1>
      <p className="auth-page__lede">
        Free, and always will be. Every book in the public library is cleared for distribution;
        an account exists so downloads stay fair, not to put a book behind a gate.
      </p>

      <AuthForm action={signUp} mode="signup" next={target} />

      <p className="auth-page__alt">
        Already have one? <a href={`/login?next=${encodeURIComponent(target)}`}>Sign in</a>.
      </p>
    </main>
  )
}
