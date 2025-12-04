import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../session.server'
import { SettingsGrid } from './settings-grid'

export default async function SettingsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl leading-tight font-semibold">Settings</h1>
      <SettingsGrid />
    </PageContainer>
  )
}
