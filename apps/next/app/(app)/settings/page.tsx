import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'

export default async function SettingsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-4 max-w-2xl">
      <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Settings</p>
      <h1 className="text-3xl font-semibold">Account</h1>
      <div className="card card-padded flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondaryText)]">
          Web settings will mirror the native experience once the new server data layer lands. For now, manage your
          profile and billing from the native app.
        </p>
      </div>
    </div>
  )
}
