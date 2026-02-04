import { z } from 'zod'
import { db } from '@/lib/db'
import { salePaymentSchema } from '../app/api/_lib/salePayments'

const createManualPaymentSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
  amount: z.union([z.string(), z.number()]).transform((value) => value.toString()),
  currency: z.string().min(1),
  method: z.enum(['cash', 'electronic']),
  specificMethodName: z.string().nullable().optional(),
})

export async function createManualSalePaymentForTrainer(
  trainerId: string,
  payload: z.infer<typeof createManualPaymentSchema>
): Promise<z.infer<typeof salePaymentSchema>> {
  const parsed = createManualPaymentSchema.parse(payload)

  const paymentResult = await db.transaction().execute(async (trx) => {
    const saleRow = await trx
      .selectFrom('sale')
      .select(['id', 'client_id'])
      .where('id', '=', parsed.saleId)
      .where('trainer_id', '=', trainerId)
      .executeTakeFirst()

    if (!saleRow) {
      throw new Error('Sale not found for trainer')
    }

    const payment = await trx
      .insertInto('payment')
      .values({
        trainer_id: trainerId,
        client_id: saleRow.client_id,
        sale_id: parsed.saleId,
        amount: parsed.amount,
        is_manual: true,
        is_credit_pack: null,
        is_subscription: null,
        is_stripe: null,
        is_scheduled_stripe: null,
      })
      .returning('id')
      .executeTakeFirst()

    if (!payment) {
      throw new Error('Failed to insert payment')
    }

    await trx
      .insertInto('payment_manual')
      .values({
        id: payment.id,
        trainer_id: trainerId,
        method: parsed.method,
        specific_method_name: parsed.specificMethodName ?? null,
        transaction_time: new Date(),
        is_manual: true,
      })
      .execute()

    await trx
      .updateTable('sale_payment_status')
      .set({ payment_status: 'paid' })
      .where('sale_id', '=', parsed.saleId)
      .execute()

    return { id: payment.id, clientId: saleRow.client_id }
  })

  return salePaymentSchema.parse({
    id: paymentResult.id,
    saleId: parsed.saleId,
    clientId: paymentResult.clientId,
    type: 'manual',
    amount: parsed.amount,
    amountRefunded: null,
    currency: parsed.currency,
    method: parsed.method,
    specificMethodName: parsed.specificMethodName ?? null,
    saleCreditPackId: null,
    creditsUsed: null,
    paymentPlanId: null,
    transactionFee: null,
    transactedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}
