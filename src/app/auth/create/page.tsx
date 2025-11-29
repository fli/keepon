import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'
import { CreateAccountForm } from '../create-account-form'
import { PageContainer } from '@/components/page-container'
import { KeeponLogo } from '@/components/keepon-logo'

export default async function CreateAccountPage() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-24 sm:py-32">
      <div className="flex w-full max-w-sm flex-col items-start gap-2 text-left">
        <KeeponLogo className="mb-4 h-8 w-auto" />
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Enter your details below to get started.</p>
      </div>
      <CreateAccountForm />
    </PageContainer>
  )
}
