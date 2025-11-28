import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../../session.server'

export default async function MakeSalePage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-4">
      <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Sales</p>
      <h1 className="text-3xl font-semibold">Collect payment</h1>
      <div className="card card-padded flex flex-col gap-3 max-w-2xl">
        <p className="text-sm text-[var(--color-secondaryText)]">
          Server actions will drive web mutations; card collection and payment requests are coming next.
        </p>
        <p className="text-sm">Use the native app for live payments today.</p>
      </div>
    </div>
  )
}
