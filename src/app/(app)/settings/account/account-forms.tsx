'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { ActionResult } from './actions'

type AccountDetails = {
  firstName: string
  lastName: string | null
  email: string
  businessName: string | null
}

type FormAction = (formData: FormData) => Promise<ActionResult>

function StatusMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null

  const tone = state.status === 'success' ? 'text-emerald-600' : 'text-destructive'

  return (
    <p className={`text-sm ${tone}`} role="status" aria-live="polite">
      {state.message}
    </p>
  )
}

export function AccountDetailsForm({
  initialValues,
  onSubmit,
}: {
  initialValues: AccountDetails
  onSubmit: FormAction
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, setState] = useState<ActionResult | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      ref={formRef}
      action={(formData) => {
        startTransition(async () => {
          const result = await onSubmit(formData)
          setState(result)
        })
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={initialValues.firstName}
            autoComplete="given-name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" defaultValue={initialValues.lastName ?? ''} autoComplete="family-name" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={initialValues.email} autoComplete="email" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="businessName">Business name</Label>
        <Input
          id="businessName"
          name="businessName"
          defaultValue={initialValues.businessName ?? ''}
          placeholder="Optional"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <StatusMessage state={state} />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export function ChangePasswordForm({ onSubmit }: { onSubmit: FormAction }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, setState] = useState<ActionResult | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (state?.status === 'success') {
      formRef.current?.reset()
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={(formData) => {
        startTransition(async () => {
          const result = await onSubmit(formData)
          setState(result)
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" minLength={5} autoComplete="new-password" required />
      </div>

      <div className="flex items-center justify-between gap-3">
        <StatusMessage state={state} />
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          {isPending ? 'Updating…' : 'Update password'}
        </Button>
      </div>
    </form>
  )
}
