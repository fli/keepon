import { z } from 'zod'

import { db, sql } from '@/lib/db'
import { type ClientReminder, type ServiceProviderReminder } from '@/lib/reminders'

const serviceProviderReminderSchema = z.object({
  type: z.enum(['email', 'notification', 'emailAndNotification']),
  timeBeforeStart: z.string().trim().min(1, 'Reminder time is required'),
})

const clientReminderSchema = z.object({
  type: z.enum(['email', 'sms', 'emailAndSms']),
  timeBeforeStart: z.string().trim().min(1, 'Reminder time is required'),
})

export const reminderSettingsSchema = z.object({
  serviceProviderReminder1: serviceProviderReminderSchema.nullable(),
  serviceProviderReminder2: serviceProviderReminderSchema.nullable(),
  clientReminder1: clientReminderSchema.nullable(),
  clientReminder2: clientReminderSchema.nullable(),
})

export type ReminderSettings = z.infer<typeof reminderSettingsSchema>

let clientReminderTypeCache: string[] | null = null

const loadClientReminderTypes = async () => {
  if (clientReminderTypeCache) return clientReminderTypeCache
  const rows = await db.selectFrom('client_appointment_reminder_type').select('type').execute()
  clientReminderTypeCache = rows.map((row) => row.type)
  return clientReminderTypeCache
}

const normalizeClientTypeFromDb = (type: string | null | undefined) => {
  if (!type) return type
  return type === 'email_and_sms' ? 'emailAndSms' : type
}

const mapClientTypeToDb = async (type: string | null | undefined) => {
  if (!type) return sql`DEFAULT`
  if (type !== 'emailAndSms') return type

  const allowed = await loadClientReminderTypes()
  if (allowed.includes('emailAndSms')) return 'emailAndSms'
  if (allowed.includes('email_and_sms')) return 'email_and_sms'
  return type
}

export async function getReminderSettings(trainerId: string): Promise<ReminderSettings> {
  const row = await db
    .selectFrom('vw_legacy_trainer')
    .select(({ ref }) => [
      ref('vw_legacy_trainer.default_service_provider_appointment_reminder_1').as('serviceProviderReminder1'),
      ref('vw_legacy_trainer.default_service_provider_appointment_reminder_2').as('serviceProviderReminder2'),
      ref('vw_legacy_trainer.default_client_appointment_reminder_1').as('clientReminder1'),
      ref('vw_legacy_trainer.default_client_appointment_reminder_2').as('clientReminder2'),
    ])
    .where('vw_legacy_trainer.id', '=', trainerId)
    .executeTakeFirst()

  if (!row) {
    throw new Error('Unable to load your reminder settings right now.')
  }

  try {
    const record = row as Record<string, unknown>

    const normalizeClientReminder = (reminder: unknown): { type: string; timeBeforeStart: string } | null => {
      if (!reminder || typeof reminder !== 'object') {
        return null
      }
      const typed = reminder as { type?: unknown; timeBeforeStart?: unknown }
      if (typeof typed.type !== 'string' || typeof typed.timeBeforeStart !== 'string') {
        return null
      }
      return {
        type: normalizeClientTypeFromDb(typed.type) ?? typed.type,
        timeBeforeStart: typed.timeBeforeStart,
      }
    }

    return reminderSettingsSchema.parse({
      serviceProviderReminder1: record.serviceProviderReminder1 ?? null,
      serviceProviderReminder2: record.serviceProviderReminder2 ?? null,
      clientReminder1: normalizeClientReminder(record.clientReminder1 ?? null),
      clientReminder2: normalizeClientReminder(record.clientReminder2 ?? null),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error('Reminder settings are stored in an unexpected format.')
    }
    throw error
  }
}

export type ReminderSettingsInput = {
  serviceProviderReminder1: ServiceProviderReminder | null
  serviceProviderReminder2: ServiceProviderReminder | null
  clientReminder1: ClientReminder | null
  clientReminder2: ClientReminder | null
}

export async function updateReminderSettings(
  trainerId: string,
  input: ReminderSettingsInput
): Promise<ReminderSettings> {
  const parsed = reminderSettingsSchema.parse(input)

  const clientType1 = await mapClientTypeToDb(parsed.clientReminder1?.type)
  const clientType2 = await mapClientTypeToDb(parsed.clientReminder2?.type)

  const updates: Record<string, unknown> = {
    default_service_provider_appointment_reminder_1: parsed.serviceProviderReminder1?.timeBeforeStart ?? null,
    default_service_provider_appointment_reminder_2: parsed.serviceProviderReminder2?.timeBeforeStart ?? null,
    default_client_appointment_reminder_1: parsed.clientReminder1?.timeBeforeStart ?? null,
    default_client_appointment_reminder_2: parsed.clientReminder2?.timeBeforeStart ?? null,
    default_service_provider_appointment_reminder_1_type: parsed.serviceProviderReminder1?.type ?? sql`DEFAULT`,
    default_service_provider_appointment_reminder_2_type: parsed.serviceProviderReminder2?.type ?? sql`DEFAULT`,
    default_client_appointment_reminder_1_type: clientType1,
    default_client_appointment_reminder_2_type: clientType2,
  }

  const updated = await db
    .updateTable('trainer')
    .set(updates)
    .where('id', '=', trainerId)
    .returning('id')
    .executeTakeFirst()

  if (!updated) {
    throw new Error('Could not save your reminder settings right now.')
  }

  return getReminderSettings(trainerId)
}
