'use server'

import { cache } from 'react'
import { z } from 'zod'

import { listClientsForTrainer } from '@/server/clients'
import { listProducts } from '@/server/products'
import { createManualSalePaymentForTrainer } from '@/server/salePayments'
import { createSaleProductForTrainer } from '@/server/saleProducts'
import { createSaleForTrainer, requestPaymentForSale } from '@/server/sales'
import { readSessionFromCookies } from '../../../../session.server'

export type ClientSummary = Awaited<ReturnType<typeof loadClients>>[number]

export type CreditPack = {
  id: string
  name: string
  description: string
  price: string
  currency: string
  totalCredits: number
}

export const loadClients = cache(async () => {
  const session = await readSessionFromCookies()
  if (!session) {
    return []
  }
  return (await listClientsForTrainer(session.trainerId)) ?? []
})

export const loadCreditPacks = cache(async (): Promise<CreditPack[]> => {
  const session = await readSessionFromCookies()
  if (!session) {
    return []
  }

  const products = await listProducts(session.trainerId, { type: 'creditPack' })

  return (
    products
      ?.filter((product) => product.type === 'creditPack')
      .map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description ?? '',
        price: product.price,
        currency: product.currency,
        totalCredits: product.totalCredits ?? 0,
      })) ?? []
  )
})

const sellSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  productId: z.string().min(1, 'productId is required'),
  paymentKind: z.enum(['record', 'request']),
  note: z.string().trim().max(500).optional(),
  passOnFee: z.boolean().optional(),
  dueDate: z.string().trim().optional(), // ISO date string
  recordMethod: z.enum(['cash', 'eft']).optional(),
  eftType: z.string().trim().max(64).optional(),
  packName: z.string().trim().min(1).optional(),
  packPrice: z
    .string()
    .regex(/^-?\d+(?:\.\d{2})$/, 'Money values must be formatted with two decimal places')
    .optional(),
  packCredits: z
    .union([z.string(), z.number()])
    .transform((value) => Number.parseInt(value as string, 10))
    .refine((value) => Number.isInteger(value) && value > 0, 'Credits must be a positive integer')
    .optional(),
})

const buildDurationFromDate = (rawDate?: string | null) => {
  if (!rawDate) {
    return null
  }
  const target = new Date(rawDate)
  if (Number.isNaN(target.getTime())) {
    return null
  }

  const now = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  const diffDays = Math.max(0, Math.round((target.getTime() - now.getTime()) / msPerDay))
  return `P${diffDays}D`
}

const findCreditPack = (packs: CreditPack[], id: string) => packs.find((pack) => pack.id === id)

export type SellResult = { status: 'paid'; saleId: string } | { status: 'requested'; saleId: string }

export async function completeCreditPackSale(input: unknown): Promise<SellResult> {
  const session = await readSessionFromCookies()
  if (!session) {
    throw new Error('Please sign in again to complete the sale.')
  }

  const parsed = sellSchema.parse(input)
  const creditPacks = await loadCreditPacks()
  const pack = findCreditPack(creditPacks, parsed.productId)

  if (!pack) {
    throw new Error('Credit pack not found for this trainer.')
  }

  const trainerId = session.trainerId
  const dueAfter = parsed.paymentKind === 'request' ? buildDurationFromDate(parsed.dueDate) : null
  const productName = parsed.packName?.trim() ?? pack.name
  const productPrice = parsed.packPrice ?? pack.price
  const productCredits = parsed.packCredits ?? pack.totalCredits

  const sale = await createSaleForTrainer(trainerId, {
    clientId: parsed.clientId,
    dueAfter: dueAfter ?? undefined,
    note: parsed.note ?? null,
    paymentRequestPassOnTransactionFee: parsed.passOnFee ?? false,
  })

  await createSaleProductForTrainer(trainerId, {
    saleId: sale.id,
    productId: pack.id,
    price: productPrice,
    currency: pack.currency,
    name: productName,
    type: 'creditPack',
    totalCredits: productCredits,
  })

  if (parsed.paymentKind === 'record') {
    if (!parsed.recordMethod) {
      throw new Error('Choose a payment method to record the sale.')
    }

    const method = parsed.recordMethod === 'cash' ? 'cash' : 'electronic'
    const specificMethodName = parsed.recordMethod === 'eft' ? (parsed.eftType ?? 'EFT') : 'Cash'

    await createManualSalePaymentForTrainer(trainerId, {
      saleId: sale.id,
      amount: productPrice,
      currency: pack.currency,
      method,
      specificMethodName,
    })

    return { status: 'paid', saleId: sale.id }
  }

  if (parsed.paymentKind === 'request') {
    await requestPaymentForSale(trainerId, sale.id)
    return { status: 'requested', saleId: sale.id }
  }

  throw new Error('Unsupported payment kind.')
}
