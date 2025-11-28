'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { loginAction } from './actions'

const initialState = { error: null as string | null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <form action={formAction} className="card card-padded flex w-full max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
        Email
        <input name="email" type="email" required className="input" autoComplete="email" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
        Password
        <input name="password" type="password" required className="input" autoComplete="current-password" />
      </label>

      {state.error ? <p className="text-sm text-[var(--color-danger)]">{state.error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-sm text-[var(--color-secondaryText)]">
        New to Keepon? <Link href="/auth/create" className="underline">Create an account</Link>
      </p>
    </form>
  )
}
