import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { getReminderSettings } from '@/server/reminders'

import { readSessionFromCookies } from '../../../../../../session.server'
import { ReminderSingleForm } from '../../../reminder-single-form'
import { updateRemindersAction } from '../../../actions'

type TargetParam = 'service-provider' | 'client'

const targetParamToKey = (param: TargetParam) =>
  param === 'service-provider' ? 'serviceProvider' : 'client'

const slotParamToNumber = (param: string | undefined): 1 | 2 | null =>
  param === '1' ? 1 : param === '2' ? 2 : null

export default function AddReminderPage({
  params,
}: {
  params: Promise<{ target: TargetParam; slot: string }>
}) {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col gap-6 py-8">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
          <h1 className="text-3xl font-semibold leading-tight">Add reminder</h1>
          <p className="text-sm text-muted-foreground">Loading reminder form…</p>
        </PageContainer>
      }
    >
      <AddReminderContent params={params} />
    </Suspense>
  )
}

async function AddReminderContent({
  params,
}: {
  params: Promise<{ target: TargetParam; slot: string }>
}) {
  const resolvedParams = await params

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const targetKey = targetParamToKey(resolvedParams.target)
  const slotParam = slotParamToNumber(resolvedParams.slot)

  let settings = null
  let error: string | null = null

  try {
    settings = await getReminderSettings(session.trainerId)
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : 'Unable to load reminder settings right now.'
  }

  if (error) {
    return (
      <PageContainer className="flex flex-col gap-6 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </PageContainer>
    )
  }

  if (!settings) {
    redirect('/settings/reminders')
  }

  const slots = targetKey === 'serviceProvider'
    ? [settings.serviceProviderReminder1, settings.serviceProviderReminder2]
    : [settings.clientReminder1, settings.clientReminder2]

  const slot =
    slotParam ??
    (slots[0] === null ? 1 : slots[1] === null ? 2 : null)

  if (!slot) {
    // No available slot to add.
    redirect('/settings/reminders')
  }

  const existingReminder = slots[slot - 1]

  if (existingReminder) {
    // Slot already occupied; send to edit flow.
    redirect(`/settings/reminders/edit/${resolvedParams.target}/${slot}`)
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
        <h1 className="text-3xl font-semibold leading-tight">
          Add {targetKey === 'serviceProvider' ? 'my' : 'client'} reminder
        </h1>
        <p className="text-sm text-muted-foreground">
          Create a single reminder for this slot. You can add a second one later.
        </p>
      </div>

      <ReminderSingleForm
        initialSettings={settings}
        target={targetKey}
        slot={slot}
        mode="add"
        onSubmit={updateRemindersAction}
      />
    </PageContainer>
  )
}
