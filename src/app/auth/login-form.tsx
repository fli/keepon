'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { loginAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const initialState = { error: null as string | null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <div className="w-full max-w-sm">
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-sm text-muted-foreground">
          New to Keepon?{' '}
          <Link href="/auth/create" className="font-medium text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  )
}
