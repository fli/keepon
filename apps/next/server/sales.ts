import { db } from '@keepon/db'
import { z } from 'zod'

const createSaleSchema = z.object({
  clientId: z.string().min(1),
  clientSessionId: z.string().uuid().nullable().optional(),
  dueAfter: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  paymentRequestPassOnTransactionFee: z.boolean().optional(),
})

const saleIdSchema = z.object({
  id: z.string(),
})

const parseDueAfter = (value?: string | null) => {
  if (!value || value.trim().length === 0) {
    return new Date()
  }

  const match = /^P(?:(\d+)W)?(?:(\d+)D)?$/i.exec(value.trim())
  if (!match) return new Date()

  const weeks = match[1] ? Number.parseInt(match[1], 10) : 0
  const days = match[2] ? Number.parseInt(match[2], 10) : 0
  const totalDays = weeks * 7 + days
  if (!Number.isFinite(totalDays) || totalDays <= 0) return new Date()

  return new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000)
}

export async function createSaleForTrainer(
  trainerId: string,
  payload: z.infer<typeof createSaleSchema>
): Promise<z.infer<typeof saleIdSchema>> {
  const parsed = createSaleSchema.parse(payload)

  const created = await db.transaction().execute(async trx => {
    const sale = await trx
      .insertInto('sale')
      .values({
        trainer_id: trainerId,
        client_id: parsed.clientId,
        note: parsed.note ?? '',
        due_time: parseDueAfter(parsed.dueAfter),
        payment_request_pass_on_transaction_fee:
          parsed.paymentRequestPassOnTransactionFee ?? false,
      })
      .returning('id')
      .executeTakeFirst()

    if (!sale) {
      throw new Error('Failed to create sale')
    }

    await trx
      .insertInto('sale_payment_status')
      .values({ sale_id: sale.id, payment_status: 'none' })
      .execute()

    if (parsed.clientSessionId) {
      const updated = await trx
        .updateTable('client_session')
        .set({ sale_id: sale.id })
        .where('id', '=', parsed.clientSessionId)
        .where('trainer_id', '=', trainerId)
        .returning('id')
        .executeTakeFirst()

      if (!updated) {
        throw new Error('Client session not found for trainer')
      }
    }

    return sale
  })

  return saleIdSchema.parse(created)
}

export async function requestPaymentForSale(trainerId: string, saleId: string) {
  const updated = await db
    .updateTable('sale')
    .set({ payment_request_time: new Date() })
    .where('id', '=', saleId)
    .where('trainer_id', '=', trainerId)
    .returning('id')
    .executeTakeFirst()

  if (!updated) {
    throw new Error('Sale not found')
  }

  await db
    .updateTable('sale_payment_status')
    .set({ payment_status: 'requested' })
    .where('sale_id', '=', saleId)
    .execute()

  return { status: 'requested' as const }
}
