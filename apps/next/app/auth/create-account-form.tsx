'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { createAccountAction } from './actions'

const initialState = { error: null as string | null }

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(createAccountAction, initialState)

  return (
    <form action={formAction} className="card card-padded flex w-full max-w-xl flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
          First name
          <input name="firstName" required className="input" autoComplete="given-name" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
          Last name
          <input name="lastName" className="input" autoComplete="family-name" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
        Email
        <input name="email" type="email" required className="input" autoComplete="email" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
        Password
        <input name="password" type="password" required className="input" autoComplete="new-password" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
        Country (2-letter)
        <input name="country" defaultValue="US" className="input" autoComplete="country" maxLength={2} />
      </label>

      {state.error ? <p className="text-sm text-[var(--color-danger)]">{state.error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>

      <p className="text-sm text-[var(--color-secondaryText)]">
        Already have an account? <Link href="/auth" className="underline">Sign in</Link>
      </p>
    </form>
  )
}
