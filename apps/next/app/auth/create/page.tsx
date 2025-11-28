import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'
import { CreateAccountForm } from '../create-account-form'

export default async function CreateAccountPage() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }

  return (
    <div className="page-shell flex flex-col items-center gap-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Create account</p>
        <h1 className="text-3xl font-semibold">Start with Keepon</h1>
        <p className="text-sm text-[var(--color-secondaryText)]">We keep your session in a secure cookie after signup.</p>
      </div>
      <CreateAccountForm />
    </div>
  )
}
