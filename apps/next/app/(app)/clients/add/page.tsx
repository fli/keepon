import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { createClientAction, readSessionFromCookies } from '../actions'
import { optionalValue, statusOptions, type StatusFilter } from 'app/features/clients/shared'

async function addClient(formData: FormData) {
  'use server'

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const firstName = (formData.get('firstName') || '').toString().trim()
  if (!firstName) {
    throw new Error('First name is required')
  }

  const payload = {
    firstName,
    lastName: optionalValue((formData.get('lastName') || '').toString()),
    email: optionalValue((formData.get('email') || '').toString()),
    mobileNumber: optionalValue((formData.get('mobileNumber') || '').toString()),
    otherNumber: optionalValue((formData.get('otherNumber') || '').toString()),
    company: optionalValue((formData.get('company') || '').toString()),
    status: (formData.get('status') as StatusFilter | null) ?? 'current',
  }

  const client = await createClientAction(payload)
  revalidatePath('/clients')
  redirect(`/clients/${client.id}`)
}

export default async function AddClientPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Clients</p>
          <h1 className="text-3xl font-semibold leading-tight">Add client</h1>
        </div>
        <a className="btn btn-secondary text-sm" href="/clients">
          Cancel
        </a>
      </div>

      <form action={addClient} className="card card-padded flex flex-col gap-4 max-w-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
            First name
            <input name="firstName" required className="input" autoComplete="given-name" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
            Last name
            <input name="lastName" className="input" autoComplete="family-name" />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
            Email
            <input name="email" type="email" className="input" autoComplete="email" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
            Mobile
            <input name="mobileNumber" className="input" autoComplete="tel" />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
          Other number
          <input name="otherNumber" className="input" />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
          Company
          <input name="company" className="input" />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--color-text)]">
          Status
          <div className="flex flex-wrap gap-2">
            {statusOptions.map(option => (
              <label key={option.id} className="pill flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="status"
                  value={option.id}
                  defaultChecked={option.id === 'current'}
                  className="accent-[var(--color-accent)]"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary text-sm">
            Save client
          </button>
          <a className="btn btn-secondary text-sm" href="/clients">
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
