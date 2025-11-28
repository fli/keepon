import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'

export default async function CalendarPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-4">
      <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Calendar</p>
      <h1 className="text-3xl font-semibold">Schedule</h1>
      <p className="text-sm text-[var(--color-secondaryText)] max-w-2xl">
        The web calendar now uses the server-rendered data layer. Native keeps live updates via TanStack Query.
      </p>
      <div className="card card-padded">
        <p className="text-sm text-[var(--color-secondaryText)]">Calendar UI coming next — your sessions will render here.</p>
      </div>
    </div>
  )
}
