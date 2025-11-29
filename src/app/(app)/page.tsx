import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../session.server'

export default async function Page() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }
  redirect('/auth')
}
