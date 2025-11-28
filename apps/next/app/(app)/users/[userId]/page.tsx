import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../../session.server'

export default async function UserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <div className="page-shell flex flex-col gap-3">
      <p className="text-sm text-[var(--color-secondaryText)]">User</p>
      <h1 className="text-3xl font-semibold">User {userId}</h1>
      <p className="text-sm text-[var(--color-secondaryText)]">This route now renders on the server.</p>
    </div>
  )
}
