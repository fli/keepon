import { db, type Point, type Selectable, type VwLegacyClient } from '@/lib/db'
import { z } from 'zod'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import type { CountryCode } from 'libphonenumber-js'
import { supportedCountryCodes } from '@/lib/supportedCountries'
import { adaptClientRow, clientListSchema } from '../app/api/clients/shared'

export type ClientList = z.infer<typeof clientListSchema>
export type ClientItem = ClientList[number]

const nullableTrimmedBase = z.union([z.string(), z.null()]).transform((value) => {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
})

const nullableTrimmedString = nullableTrimmedBase.optional()

const nullableEmail = nullableTrimmedBase
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: 'Email must be a valid email address.',
  })
  .optional()

const nullablePhoneString = nullableTrimmedString

const birthdaySchema = z.preprocess((value) => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  return value
}, z.union([z.coerce.date().refine((date) => !Number.isNaN(date.getTime()), 'Invalid date'), z.null()]).optional())

const geoSchema = z
  .union([z.object({ lat: z.number(), lng: z.number() }), z.object({ lat: z.null(), lng: z.null() })])
  .nullable()
  .optional()

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10)

const normalizePhoneNumber = (value?: string | null): string | null => {
  const raw = value?.trim()
  if (!raw) return null

  for (const country of supportedCountryCodes) {
    const parsed = parsePhoneNumberFromString(raw, country as CountryCode)
    if (parsed?.isValid()) {
      return parsed.format('E.164')
    }

    const parsedWithoutPlus = parsePhoneNumberFromString(raw.replace(/^\+/, ''), country as CountryCode)
    if (parsedWithoutPlus?.isValid()) {
      return parsedWithoutPlus.format('E.164')
    }
  }

  return null
}

export const createClientSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: nullableTrimmedString,
  email: nullableEmail,
  mobileNumber: nullablePhoneString,
  otherNumber: nullablePhoneString,
  status: z.enum(['current', 'lead', 'past']).default('current'),
  company: nullableTrimmedString,
  location: nullableTrimmedString,
  address: nullableTrimmedString,
  googlePlaceId: nullableTrimmedString,
  geo: geoSchema,
  birthday: birthdaySchema,
  emergencyContactName: nullableTrimmedString,
  emergencyContactMobileNumber: nullablePhoneString,
})

export type CreateClientInput = z.infer<typeof createClientSchema>

export async function listClientsForTrainer(trainerId: string, sessionId?: string | null): Promise<ClientList> {
  let clientQuery = db
    .selectFrom('vw_legacy_client as client')
    .selectAll('client')
    .where('client.trainerId', '=', trainerId)

  if (sessionId) {
    const sessionClients = db
      .selectFrom('client_session')
      .select('client_session.client_id')
      .where('client_session.session_id', '=', sessionId)
      .as('session_clients')

    clientQuery = clientQuery.innerJoin(sessionClients, 'session_clients.client_id', 'client.id')
  }

  const clientRows = await clientQuery.execute()
  return clientListSchema.parse(clientRows.map(adaptClientRow))
}

export async function createClientForTrainer(trainerId: string, payload: CreateClientInput): Promise<ClientItem> {
  const parsed = createClientSchema.parse(payload)
  const geo: Point | null =
    parsed.geo && parsed.geo.lat !== null && parsed.geo.lng !== null ? { x: parsed.geo.lat, y: parsed.geo.lng } : null

  const birthday = parsed.birthday ? formatDateOnly(parsed.birthday) : null
  const mobileNumber = normalizePhoneNumber(parsed.mobileNumber ?? null)
  const otherNumber = normalizePhoneNumber(parsed.otherNumber ?? null)
  const emergencyContactMobileNumber = normalizePhoneNumber(parsed.emergencyContactMobileNumber ?? null)

  const created: Selectable<VwLegacyClient>[] = await db.transaction().execute(async (trx) => {
    const userRows = await trx
      .insertInto('user_')
      .values([{ type: 'client' }])
      .returning('id')
      .execute()

    const userId = userRows[0]?.id
    if (!userId) {
      throw new Error('Failed to create user record for client')
    }

    const clientRows = await trx
      .insertInto('client')
      .values({
        user_id: userId,
        user_type: 'client',
        trainer_id: trainerId,
        first_name: parsed.firstName,
        last_name: parsed.lastName ?? null,
        email: parsed.email ?? null,
        mobile_number: mobileNumber,
        other_number: otherNumber,
        emergency_contact_name: parsed.emergencyContactName ?? null,
        emergency_contact_mobile_number: emergencyContactMobileNumber,
        birthday,
        status: parsed.status,
        company: parsed.company ?? null,
        location: parsed.location ?? null,
        address: parsed.address ?? null,
        google_place_id: parsed.googlePlaceId ?? null,
        geo,
      })
      .returning('id')
      .execute()

    const ids = clientRows.map((row) => row.id)

    const newClients = await trx.selectFrom('vw_legacy_client').selectAll().where('id', 'in', ids).execute()

    return newClients
  })

  const parsedClients = clientListSchema.parse(created.map(adaptClientRow))
  const [firstClient] = parsedClients
  if (!firstClient) {
    throw new Error('Failed to load created client')
  }
  return firstClient
}
