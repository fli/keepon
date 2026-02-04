import { z } from 'zod'
import { db, sql } from '@/lib/db'

const nullableString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()

const accountDetailsSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().email(),
  businessName: z.string().nullable(),
  timezone: z.string().nullable(),
  locale: z.string().nullable(),
  brandColor: z.string().nullable(),
})

const updateAccountSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: nullableString,
  email: z.string().trim().email('Enter a valid email address'),
  businessName: nullableString,
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(5, 'New password must be at least 5 characters'),
})

export type AccountDetails = z.infer<typeof accountDetailsSchema>

export type UpdateAccountPayload = {
  firstName: string
  lastName?: string | null
  email: string
  businessName?: string | null
}

export type ChangePasswordPayload = {
  currentPassword: string
  newPassword: string
}

export async function getTrainerAccount(trainerId: string): Promise<AccountDetails> {
  const row = await db
    .selectFrom('trainer')
    .select((eb) => [
      eb.ref('trainer.id').as('id'),
      eb.ref('trainer.first_name').as('firstName'),
      eb.ref('trainer.last_name').as('lastName'),
      eb.ref('trainer.email').as('email'),
      eb.ref('trainer.business_name').as('businessName'),
      eb.ref('trainer.timezone').as('timezone'),
      eb.ref('trainer.locale').as('locale'),
      eb.ref('trainer.brand_color').as('brandColor'),
    ])
    .where('trainer.id', '=', trainerId)
    .executeTakeFirst()

  if (!row) {
    throw new Error('Unable to load your account right now.')
  }

  return accountDetailsSchema.parse(row)
}

export async function updateTrainerAccount(trainerId: string, payload: UpdateAccountPayload): Promise<AccountDetails> {
  const parsed = updateAccountSchema.parse(payload)

  const emailTaken = await db
    .selectFrom('trainer')
    .select('id')
    .where(sql<boolean>`LOWER(email) = LOWER(${parsed.email})`)
    .where('id', '!=', trainerId)
    .executeTakeFirst()

  if (emailTaken) {
    throw new Error('That email address is already in use.')
  }

  const updated = await db
    .updateTable('trainer')
    .set({
      first_name: parsed.firstName,
      last_name: parsed.lastName ?? null,
      email: parsed.email,
      business_name: parsed.businessName ?? null,
    })
    .where('id', '=', trainerId)
    .returning((eb) => [
      eb.ref('trainer.id').as('id'),
      eb.ref('trainer.first_name').as('firstName'),
      eb.ref('trainer.last_name').as('lastName'),
      eb.ref('trainer.email').as('email'),
      eb.ref('trainer.business_name').as('businessName'),
      eb.ref('trainer.timezone').as('timezone'),
      eb.ref('trainer.locale').as('locale'),
      eb.ref('trainer.brand_color').as('brandColor'),
    ])
    .executeTakeFirst()

  if (!updated) {
    throw new Error('We could not save your changes. Please try again.')
  }

  return accountDetailsSchema.parse(updated)
}

export async function changeTrainerPassword(trainerId: string, payload: ChangePasswordPayload): Promise<void> {
  const { currentPassword, newPassword } = changePasswordSchema.parse(payload)

  const result = await sql<{ changed: boolean }>`
    UPDATE trainer
       SET password_hash = crypt(${newPassword}, gen_salt('bf', 10))
     WHERE id = ${trainerId}
       AND password_hash = crypt(${currentPassword}, password_hash)
     RETURNING TRUE as changed
  `.execute(db)

  const row = result.rows[0]

  if (!row) {
    throw new Error('Current password is incorrect.')
  }
}
