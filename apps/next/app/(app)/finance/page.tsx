import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'

export default async function FinancePage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-4">
      <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Finance</p>
      <h1 className="text-3xl font-semibold">Revenue snapshot</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card card-padded flex flex-col gap-2">
          <p className="text-sm text-[var(--color-secondaryText)]">Payouts</p>
          <p className="text-lg font-semibold">Reconciliation moves to the dashboard data source.</p>
        </div>
        <div className="card card-padded flex flex-col gap-2">
          <p className="text-sm text-[var(--color-secondaryText)]">Overdue</p>
          <p className="text-sm text-[var(--color-secondaryText)]">Detailed charts will land once the new server pipelines are wired.</p>
        </div>
      </div>
    </div>
  )
}
