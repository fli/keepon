import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import Link from 'next/link'

import { PageContainer } from '@/components/page-container'
import { reminderOptions } from '@/lib/reminders'
import { getReminderSettings } from '@/server/reminders'
import { Button } from '@/components/ui/button'

import { readSessionFromCookies } from '../../../session.server'

export default function RemindersSettingsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col gap-6 py-8">
          <h1 className="text-3xl font-semibold leading-tight">Reminders</h1>
          <p className="text-sm text-muted-foreground">Loading your reminder settings…</p>
        </PageContainer>
      }
    >
      <RemindersSettingsContent />
    </Suspense>
  )
}

async function RemindersSettingsContent() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let error: string | null = null
  let settings = null

  try {
    settings = await getReminderSettings(session.trainerId)
  } catch (cause) {
    console.error('Failed to load reminder settings', cause)
    error = cause instanceof Error ? cause.message : 'Unable to load reminder settings right now.'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
        <h1 className="text-3xl font-semibold leading-tight">Reminders</h1>
        <p className="text-sm text-muted-foreground">
          Default reminders for you and your clients. To add or edit, open the manage page.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {settings ? (
        <div className="flex flex-col gap-10">
          <ReminderSection
            title="My default reminders"
            description="Sent to you before sessions you host."
            reminders={[settings.serviceProviderReminder1, settings.serviceProviderReminder2]}
            targetSlug="service-provider"
          />
          <ReminderSection
            title="Client default reminders"
            description="Sent to clients for sessions you create or that are booked online."
            reminders={[settings.clientReminder1, settings.clientReminder2]}
            targetSlug="client"
          />
        </div>
      ) : null}
    </PageContainer>
  )
}

type ReminderDisplay = {
  label: string
  time: string
} | null

const displayReminder = (reminder: { type: string; timeBeforeStart: string } | null): ReminderDisplay => {
  if (!reminder) return null

  const timeLabel =
    reminderOptions.find((option) => option.value === reminder.timeBeforeStart)?.name ??
    `Custom (${reminder.timeBeforeStart})`

  const typeLabel = (() => {
    switch (reminder.type) {
      case 'email':
        return 'Email'
      case 'sms':
        return 'Text'
      case 'emailAndSms':
        return 'Email & Text'
      case 'notification':
        return 'Notification'
      case 'emailAndNotification':
        return 'Email & Notification'
      default:
        return reminder.type
    }
  })()

  return { label: typeLabel, time: timeLabel }
}

function ReminderSection({
  title,
  description,
  reminders,
  targetSlug,
}: {
  title: string
  description: string
  reminders: Array<{ type: string; timeBeforeStart: string } | null>
  targetSlug: 'service-provider' | 'client'
}) {
  const items = reminders
    .map((reminder, index) => ({
      display: displayReminder(reminder),
      slot: (index + 1) as 1 | 2,
    }))
    .filter((item): item is { display: NonNullable<typeof item.display>; slot: 1 | 2 } => Boolean(item.display))
  const nextSlot = reminders[0] === null ? 1 : reminders[1] === null ? 2 : null

  return (
    <section className="space-y-3">
      <div>
        <p className="text-lg font-semibold leading-tight">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reminders set.</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card/30">
          {items.map((item) => (
            <li
              key={`${item.display.label}-${item.display.time}-${item.slot}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{item.display.label}</span>
                <span className="text-sm text-muted-foreground">{item.display.time}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/settings/reminders/edit/${targetSlug}/${item.slot}`} />}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={!nextSlot}
        render={nextSlot ? <Link href={`/settings/reminders/add/${targetSlug}/${nextSlot}`} /> : undefined}
      >
        Add reminder
      </Button>
    </section>
  )
}
