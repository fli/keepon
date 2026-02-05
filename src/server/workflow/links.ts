import type { Kysely, Transaction } from 'kysely'
import { addDays } from 'date-fns'
import type { Database } from '@/lib/db'

type DbExecutor = Kysely<Database> | Transaction<Database>

export const createClientDashboardLink = async (
  executor: DbExecutor,
  { clientId, clientEmail }: { clientId: string; clientEmail: string }
) => {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

  const clientRow = await executor
    .selectFrom('client')
    .select((eb) => [eb.ref('client.user_id').as('userId')])
    .where('client.id', '=', clientId)
    .executeTakeFirst()

  if (!clientRow?.userId) {
    throw new Error('Failed to resolve client for dashboard link')
  }

  const tokenRow = await executor
    .insertInto('access_token')
    .values({
      user_id: clientRow.userId,
      user_type: 'client',
      type: 'client_dashboard',
      expires_at: addDays(new Date(), 7),
    })
    .returning('id')
    .executeTakeFirst()

  if (!tokenRow?.id) {
    throw new Error('Failed to create client dashboard token')
  }

  const link = new URL(baseUrl)
  link.pathname = '/client-dashboard/link'
  link.hash = `/client/${clientId}/${tokenRow.id}?email=${encodeURIComponent(clientEmail)}`

  return link
}
