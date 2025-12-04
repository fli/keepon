import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { getReminderSettings } from '@/server/reminders'

import { readSessionFromCookies } from '../../../../../../session.server'
import { ReminderSingleForm } from '../../../reminder-single-form'
import { updateRemindersAction } from '../../../actions'

type TargetParam = 'service-provider' | 'client'

const targetParamToKey = (param: TargetParam) => (param === 'service-provider' ? 'serviceProvider' : 'client')

const slotParamToNumber = (param: string): 1 | 2 | null => (param === '1' ? 1 : param === '2' ? 2 : null)

export default function EditReminderPage({ params }: { params: Promise<{ target: TargetParam; slot: string }> }) {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col gap-6 py-8">
          <p className="text-sm tracking-wide text-muted-foreground uppercase">Settings</p>
          <h1 className="text-3xl leading-tight font-semibold">Edit reminder</h1>
          <p className="text-sm text-muted-foreground">Loading reminder…</p>
        </PageContainer>
      }
    >
      <EditReminderContent params={params} />
    </Suspense>
  )
}

async function EditReminderContent({ params }: { params: Promise<{ target: TargetParam; slot: string }> }) {
  const resolvedParams = await params

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const targetKey = targetParamToKey(resolvedParams.target)
  const slot = slotParamToNumber(resolvedParams.slot)

  if (!slot) {
    redirect('/settings/reminders')
  }

  let settings = null
  let error: string | null = null

  try {
    settings = await getReminderSettings(session.trainerId)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Unable to load reminder settings right now.'
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

  const existingReminder =
    targetKey === 'serviceProvider'
      ? slot === 1
        ? settings.serviceProviderReminder1
        : settings.serviceProviderReminder2
      : slot === 1
        ? settings.clientReminder1
        : settings.clientReminder2

  if (!existingReminder) {
    // If the slot is empty, send them to the add flow for this target and slot.
    redirect(`/settings/reminders/add/${resolvedParams.target}/${slot}`)
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-2">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">Settings</p>
        <h1 className="text-3xl leading-tight font-semibold">
          Edit {targetKey === 'serviceProvider' ? 'my' : 'client'} reminder
        </h1>
      </div>

      <ReminderSingleForm
        initialSettings={settings}
        target={targetKey}
        slot={slot}
        mode="edit"
        onSubmit={updateRemindersAction}
      />
    </PageContainer>
  )
}
