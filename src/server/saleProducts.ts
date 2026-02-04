import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { adaptSaleProductRow, fetchSaleProducts, saleProductSchema } from '../app/api/saleProducts/shared'

const createSaleProductSchema = z.object({
  saleId: z.string().uuid(),
  productId: z.string().optional(),
  price: z.union([z.string(), z.number()]).transform((v) => v.toString()),
  currency: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['creditPack', 'item', 'service']),
  totalCredits: z.number().int().optional(),
  quantity: z.number().int().optional(),
  durationMinutes: z.number().int().optional(),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
})

export async function createSaleProductForTrainer(
  trainerId: string,
  payload: z.infer<typeof createSaleProductSchema>
): Promise<z.infer<typeof saleProductSchema>> {
  const parsed = createSaleProductSchema.parse(payload)

  const saleProductId = await db.transaction().execute(async (trx) => {
    const sale = await trx
      .selectFrom('sale')
      .select(['id', 'client_id'])
      .where('id', '=', parsed.saleId)
      .where('trainer_id', '=', trainerId)
      .executeTakeFirst()

    if (!sale) {
      throw new Error('Sale not found for trainer')
    }

    const inserted = await trx
      .insertInto('sale_product')
      .values({
        trainer_id: trainerId,
        client_id: sale.client_id,
        sale_id: parsed.saleId,
        price: parsed.price,
        name: parsed.name,
        product_id: parsed.productId ?? null,
        is_credit_pack: parsed.type === 'creditPack',
        is_item: parsed.type === 'item',
        is_service: parsed.type === 'service',
        is_membership: null,
      })
      .returning('id')
      .executeTakeFirst()

    if (!inserted) {
      throw new Error('Failed to insert sale product')
    }

    switch (parsed.type) {
      case 'creditPack': {
        await trx
          .insertInto('sale_credit_pack')
          .values({
            id: inserted.id,
            trainer_id: trainerId,
            total_credits: parsed.totalCredits ?? 0,
            is_credit_pack: true,
          })
          .execute()
        break
      }
      case 'item': {
        await trx
          .insertInto('sale_item')
          .values({
            id: inserted.id,
            trainer_id: trainerId,
            quantity: parsed.quantity ?? 1,
            is_item: true,
          })
          .execute()
        break
      }
      case 'service': {
        const minutes = parsed.durationMinutes ?? 60
        await trx
          .insertInto('sale_service')
          .values({
            id: inserted.id,
            trainer_id: trainerId,
            duration: sql`make_interval(mins := ${minutes})`,
            location: parsed.location ?? null,
            address: parsed.address ?? null,
            google_place_id: parsed.googlePlaceId ?? null,
            geo: null,
            is_service: true,
          })
          .execute()
        break
      }
    }

    return inserted.id
  })

  const rows = await fetchSaleProducts(trainerId, { saleProductId })
  const [firstRow] = rows
  if (!firstRow) {
    throw new Error('Sale product not found after creation')
  }

  return saleProductSchema.parse(adaptSaleProductRow(firstRow))
}
