import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../session.server'
import { LoginForm } from './login-form'

export default async function AuthPage() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }

  return (
    <div className="page-shell flex flex-col items-center gap-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Welcome</p>
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="text-sm text-[var(--color-secondaryText)]">Access your coaching workspace from the web.</p>
      </div>
      <LoginForm />
    </div>
  )
}
