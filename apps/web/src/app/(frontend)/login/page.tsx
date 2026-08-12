import { redirect } from 'next/navigation'
import React from 'react'

import { AuthForm } from '../../../components/AuthForm'
import { getCurrentUser, safeNext } from '../../../lib/auth'
import { login } from '../actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

export default async function LoginPage({
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
      <h1>Sign in</h1>
      <p className="auth-page__lede">
        An account is what makes downloads possible — it is how the library keeps track of your
        reading, not a way of tracking you.
      </p>

      <AuthForm action={login} mode="login" next={target} />

      <p className="auth-page__alt">
        No account yet?{' '}
        <a href={`/sign-up?next=${encodeURIComponent(target)}`}>Create one</a>.
      </p>
    </main>
  )
}
