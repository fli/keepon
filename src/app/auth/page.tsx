import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../session.server'
import { LoginForm } from './login-form'
import { PageContainer } from '@/components/page-container'

export default async function AuthPage() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Welcome</p>
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Access your coaching workspace from the web.</p>
      </div>
      <LoginForm />
    </PageContainer>
  )
}
