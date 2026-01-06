import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageContainer } from '@/components/page-container'

import { createClientAction, readSessionFromCookies } from '../actions'
import { optionalValue, statusOptions, type StatusFilter, isStatusFilter } from '@/lib/app/features/clients/shared'

const getFormString = (formData: FormData, key: string, fallback = '') => {
  const value = formData.get(key)
  return typeof value === 'string' ? value : fallback
}

async function addClient(formData: FormData) {
  'use server'

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const firstName = getFormString(formData, 'firstName').trim()
  if (!firstName) {
    throw new Error('First name is required')
  }

  const statusValue = getFormString(formData, 'status')

  const payload = {
    firstName,
    lastName: optionalValue(getFormString(formData, 'lastName')),
    email: optionalValue(getFormString(formData, 'email')),
    mobileNumber: optionalValue(getFormString(formData, 'mobileNumber')),
    otherNumber: optionalValue(getFormString(formData, 'otherNumber')),
    company: optionalValue(getFormString(formData, 'company')),
    status: isStatusFilter(statusValue) ? statusValue : ('current' as StatusFilter),
  }

  const client = await createClientAction(payload)
  revalidatePath('/clients')
  redirect(`/clients/${client.id}`)
}

export default function AddClientPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col items-center gap-6 py-8">
          <h1 className="text-3xl leading-tight font-semibold">Add client</h1>
          <p className="text-sm text-muted-foreground">Loading form…</p>
        </PageContainer>
      }
    >
      <AddClientContent />
    </Suspense>
  )
}

async function AddClientContent() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-8">
      <div className="flex w-full max-w-xl flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold">Add client</h1>
        <p className="text-sm text-muted-foreground">Create a client record to track status and contact details.</p>
      </div>

      <form action={addClient} className="w-full max-w-xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required autoComplete="given-name" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="mobileNumber">Mobile</Label>
          <Input id="mobileNumber" name="mobileNumber" autoComplete="tel" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="otherNumber">Other number</Label>
          <Input id="otherNumber" name="otherNumber" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input id="company" name="company" />
        </div>

        <div className="space-y-2">
          <p className="text-sm leading-none font-medium">Status</p>
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <input
                  type="radio"
                  name="status"
                  value={option.id}
                  defaultChecked={option.id === 'current'}
                  className="sr-only"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Save client
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
