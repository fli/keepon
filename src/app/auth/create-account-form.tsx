'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createAccountAction } from './actions'

const initialState = {
  error: null as string | null,
  defaultValues: {
    firstName: '',
    lastName: '',
    email: '',
    country: 'US',
  },
}

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(createAccountAction, initialState)

  return (
    <div className="w-full max-w-sm">
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            autoComplete="given-name"
            defaultValue={state.defaultValues?.firstName}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            defaultValue={state.defaultValues?.lastName ?? ''}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.defaultValues?.email}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input 
            id="password" 
            name="password" 
            type="password" 
            required 
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="country">Country (2-letter)</Label>
          <Input
            id="country"
            name="country"
            defaultValue={state.defaultValues?.country ?? 'US'}
            autoComplete="country"
            maxLength={2}
          />
        </div>

        {state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Creating…' : 'Sign up'}
        </Button>

        <p className="text-left text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/auth" className="font-medium text-foreground underline underline-offset-4">
            Log in
          </Link>
        </p>
      </form>
    </div>
  )
}
