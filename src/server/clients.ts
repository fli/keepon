import { db, type Point, type Selectable, type VwLegacyClient } from '@/lib/db'
import { z } from 'zod'
import { adaptClientRow, clientListSchema } from '../app/api/clients/shared'

export type ClientList = z.infer<typeof clientListSchema>
export type ClientItem = ClientList[number]

const nullableTrimmedString = z
  .string()
  .trim()
  .transform(value => (value.length === 0 ? null : value))
  .nullable()
  .optional()

export const createClientSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required'),
  lastName: nullableTrimmedString,
  email: nullableTrimmedString,
  mobileNumber: nullableTrimmedString,
  otherNumber: nullableTrimmedString,
  status: z.enum(['current', 'lead', 'past']).default('current'),
  company: nullableTrimmedString,
  location: nullableTrimmedString,
  address: nullableTrimmedString,
  googlePlaceId: nullableTrimmedString,
  geo: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
})

export type CreateClientInput = z.infer<typeof createClientSchema>

export async function listClientsForTrainer(
  trainerId: string,
  sessionId?: string | null
): Promise<ClientList> {
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

    clientQuery = clientQuery.innerJoin(
      sessionClients,
      'session_clients.client_id',
      'client.id'
    )
  }

  const clientRows = await clientQuery.execute()
  return clientListSchema.parse(clientRows.map(adaptClientRow))
}

export async function createClientForTrainer(
  trainerId: string,
  payload: CreateClientInput
): Promise<ClientItem> {
  const parsed = createClientSchema.parse(payload)
  const geo: Point | null = parsed.geo
    ? { x: parsed.geo.lat, y: parsed.geo.lng }
    : null

  const created: Selectable<VwLegacyClient>[] = await db.transaction().execute(async trx => {
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
        mobile_number: parsed.mobileNumber ?? null,
        other_number: parsed.otherNumber ?? null,
        status: parsed.status,
        company: parsed.company ?? null,
        location: parsed.location ?? null,
        address: parsed.address ?? null,
        google_place_id: parsed.googlePlaceId ?? null,
        geo,
      })
      .returning('id')
      .execute()

    const ids = clientRows.map(row => row.id)

    const newClients = await trx
      .selectFrom('vw_legacy_client')
      .selectAll()
      .where('id', 'in', ids)
      .execute()

    return newClients
  })

  const parsedClients = clientListSchema.parse(created.map(adaptClientRow))
  const [firstClient] = parsedClients
  if (!firstClient) {
    throw new Error('Failed to load created client')
  }
  return firstClient
}
