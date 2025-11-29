'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createAccountAction } from './actions'

const initialState = { error: null as string | null }

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(createAccountAction, initialState)

  return (
    <Card className="w-full max-w-xl">
      <form action={formAction} className="space-y-4">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>We keep your session in a secure cookie after signup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" required autoComplete="given-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" autoComplete="family-name" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="new-password" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country (2-letter)</Label>
            <Input id="country" name="country" defaultValue="US" autoComplete="country" maxLength={2} />
          </div>

          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </Button>

          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/auth" className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </form>
    </Card>
  )
}
