'use client'

import { useMemo, useState, useTransition } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  clientReminderTypes,
  reminderOptions,
  serviceProviderReminderTypes,
  type ClientReminder,
  type ServiceProviderReminder,
} from '@/lib/reminders'
import { type ReminderSettings } from '@/server/reminders'
import type { ActionResult } from './actions'

type Target = 'serviceProvider' | 'client'
type Slot = 1 | 2

const defaultServiceProviderReminder: ServiceProviderReminder = {
  type: 'emailAndNotification',
  timeBeforeStart: 'PT1H',
}

const defaultClientReminder: ClientReminder = {
  type: 'emailAndSms',
  timeBeforeStart: 'PT1H',
}

export function ReminderSingleForm({
  initialSettings,
  target,
  slot,
  mode,
  onSubmit,
}: {
  initialSettings: ReminderSettings
  target: Target
  slot: Slot
  mode: 'add' | 'edit'
  onSubmit: (formData: FormData) => Promise<ActionResult>
}) {
  const initialReminder =
    target === 'serviceProvider'
      ? slot === 1
        ? initialSettings.serviceProviderReminder1
        : initialSettings.serviceProviderReminder2
      : slot === 1
        ? initialSettings.clientReminder1
        : initialSettings.clientReminder2

  const [reminder, setReminder] = useState<
    ServiceProviderReminder | ClientReminder | null
  >(
    mode === 'add'
      ? initialReminder ??
          (target === 'serviceProvider'
            ? defaultServiceProviderReminder
            : defaultClientReminder)
      : initialReminder
  )

  const [status, setStatus] = useState<ActionResult | null>(null)
  const [isPending, startTransition] = useTransition()

  const mergedHiddenFields = useMemo(() => {
    const toPairs = (
      current: ServiceProviderReminder | ClientReminder | null,
      prefix: string
    ) => [
      { name: `${prefix}Type`, value: current?.type ?? '' },
      { name: `${prefix}Time`, value: current?.timeBeforeStart ?? '' },
    ]

    const sp1 =
      target === 'serviceProvider' && slot === 1 ? reminder : initialSettings.serviceProviderReminder1
    const sp2 =
      target === 'serviceProvider' && slot === 2 ? reminder : initialSettings.serviceProviderReminder2
    const c1 =
      target === 'client' && slot === 1 ? reminder : initialSettings.clientReminder1
    const c2 =
      target === 'client' && slot === 2 ? reminder : initialSettings.clientReminder2

    return [
      ...toPairs(sp1, 'serviceProviderReminder1'),
      ...toPairs(sp2, 'serviceProviderReminder2'),
      ...toPairs(c1, 'clientReminder1'),
      ...toPairs(c2, 'clientReminder2'),
    ]
  }, [reminder, target, slot, initialSettings])

  return (
    <form
      className="space-y-6"
      action={formData => {
        startTransition(async () => {
          const result = await onSubmit(formData)
          setStatus(result)
        })
      }}
    >
      {mergedHiddenFields.map(field => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}

      <div className="space-y-1">
        <p className="text-lg font-semibold leading-tight">
          {mode === 'add' ? 'Add reminder' : 'Edit reminder'}
        </p>
        <p className="text-sm text-muted-foreground">
          {target === 'serviceProvider'
            ? 'Sent to you before sessions you host.'
            : 'Sent to clients for sessions you create or that are booked online.'}
        </p>
      </div>

      {reminder ? (
        <ReminderFields
          value={reminder}
          target={target}
          onChange={value => setReminder(value)}
          onClear={mode === 'add' ? undefined : () => setReminder(null)}
          disabled={isPending}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Reminder removed.</p>
      )}

      <div className="flex items-center justify-between gap-3">
        {status ? (
          <p
            role="status"
            aria-live="polite"
            className={`text-sm ${
              status.status === 'success' ? 'text-emerald-600' : 'text-destructive'
            }`}
          >
            {status.message}
          </p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function ReminderFields({
  value,
  target,
  onChange,
  onClear,
  disabled,
}: {
  value: ServiceProviderReminder | ClientReminder
  target: Target
  onChange: (value: ServiceProviderReminder | ClientReminder) => void
  onClear?: () => void
  disabled?: boolean
}) {
  const typeOptions = target === 'serviceProvider' ? serviceProviderReminderTypes : clientReminderTypes

  const hasCustomTime = useMemo(
    () => !reminderOptions.some(option => option.value === value.timeBeforeStart),
    [value.timeBeforeStart]
  )

  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">Reminder type</Label>
          <NativeSelect
            value={value.type}
            onChange={event =>
              onChange({
                ...value,
                type: event.target.value as (typeof value)['type'],
              })
            }
          >
            {typeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">Send</Label>
          <NativeSelect
            value={value.timeBeforeStart}
            onChange={event =>
              onChange({
                ...value,
                timeBeforeStart: event.target.value,
              })
            }
          >
            {hasCustomTime ? (
              <option value={value.timeBeforeStart}>
                Custom ({value.timeBeforeStart})
              </option>
            ) : null}
            {reminderOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {onClear ? (
          <div className="flex items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClear}
              aria-label="Remove reminder"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}
