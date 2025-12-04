import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { getTrainerAccount, type AccountDetails } from '@/server/account'
import { readSessionFromCookies } from '../../../session.server'
import { AccountDetailsForm, ChangePasswordForm } from './account-forms'
import { changePasswordAction, updateAccountAction } from './actions'

export default async function AccountSettingsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let account: AccountDetails | null = null
  let loadError: string | null = null

  try {
    account = await getTrainerAccount(session.trainerId)
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : 'Unable to load your account details.'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
        <h1 className="text-3xl font-semibold leading-tight">My account</h1>
        <p className="text-sm text-muted-foreground">
          Update your profile details and keep your account secure.
        </p>
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      </div>

      {account ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle>Your info</CardTitle>
              <CardDescription>Names, email, and business identity.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <AccountDetailsForm initialValues={account} onSubmit={updateAccountAction} />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Use a unique password to protect your account.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ChangePasswordForm onSubmit={changePasswordAction} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageContainer>
  )
}
