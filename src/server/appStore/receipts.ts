import { z } from 'zod'
import { db, type Json } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'

const APP_STORE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt'
const APP_STORE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt'

const inAppReceiptSchema = z
  .object({
    transaction_id: z.string().min(1),
    original_transaction_id: z.string().min(1),
    product_id: z.string().min(1),
    purchase_date: z.string().min(1),
    purchase_date_ms: z.string().regex(/^\d+$/, {
      message: 'purchase_date_ms must be a millisecond timestamp string',
    }),
    expires_date: z.string().min(1),
    expires_date_ms: z.string().regex(/^\d+$/, {
      message: 'expires_date_ms must be a millisecond timestamp string',
    }),
    web_order_line_item_id: z.string().min(1),
    is_trial_period: z.enum(['true', 'false']),
    is_in_intro_offer_period: z.enum(['true', 'false']),
  })
  .passthrough()

const pendingRenewalInfoSchema = z
  .object({
    product_id: z.string().min(1),
    original_transaction_id: z.string().min(1),
    auto_renew_status: z.enum(['0', '1']),
  })
  .passthrough()

const successResponseSchema = z
  .object({
    status: z.literal(0),
    latest_receipt: z.string(),
    latest_receipt_info: z.array(inAppReceiptSchema).min(1),
    receipt: z.unknown(),
    pending_renewal_info: z.array(pendingRenewalInfoSchema).optional(),
  })
  .passthrough()

export type SuccessReceiptPayload = z.infer<typeof successResponseSchema>
export type PendingRenewalInfo = z.infer<typeof pendingRenewalInfoSchema>
type InAppReceipt = z.infer<typeof inAppReceiptSchema>
type AppleReceiptPayload = { status: number | string } & Record<string, unknown>

type AppStoreTransactionInsert = {
  transaction_id: string
  original_transaction_id: string
  product_id: string
  purchase_date: Date
  expires_date: Date
  web_order_line_item_id: string
  is_trial_period: boolean
  is_in_intro_offer_period: boolean
  encoded_receipt: string
  trainer_id: string
}

export class AppStoreReceiptError extends Error {
  constructor(
    public readonly kind: 'user-conflict' | 'temporary' | 'unexpected' | 'invalid-parameters',
    message?: string
  ) {
    super(message)
    this.name = 'AppStoreReceiptError'
  }
}

type PgError = { code?: string; constraint?: string }

const isPgError = (error: unknown): error is PgError =>
  typeof error === 'object' && error !== null && 'code' in error && typeof (error as PgError).code === 'string'

const toDateFromMillis = (value: string, label: string) => {
  const ms = Number(value)
  if (!Number.isFinite(ms)) {
    throw new AppStoreReceiptError('unexpected', `${label} was not a valid millisecond timestamp.`)
  }

  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) {
    throw new AppStoreReceiptError('unexpected', `${label} was not a valid millisecond timestamp.`)
  }

  return date
}

const normalizeInAppReceipt = (
  receipt: InAppReceipt,
  encodedReceipt: string,
  trainerId: string
): AppStoreTransactionInsert => ({
  transaction_id: receipt.transaction_id,
  original_transaction_id: receipt.original_transaction_id,
  product_id: receipt.product_id,
  purchase_date: toDateFromMillis(receipt.purchase_date_ms, 'purchase_date_ms'),
  expires_date: toDateFromMillis(receipt.expires_date_ms, 'expires_date_ms'),
  web_order_line_item_id: receipt.web_order_line_item_id,
  is_trial_period: receipt.is_trial_period === 'true',
  is_in_intro_offer_period: receipt.is_in_intro_offer_period === 'true',
  encoded_receipt: encodedReceipt,
  trainer_id: trainerId,
})

const insertReceiptData = async ({
  trainerId,
  receipts,
  pendingRenewalInfo,
}: {
  trainerId: string
  receipts: AppStoreTransactionInsert[]
  pendingRenewalInfo?: PendingRenewalInfo[]
}) => {
  await db.transaction().execute(async (trx) => {
    try {
      await trx
        .insertInto('app_store_transaction')
        .values(receipts)
        .onConflict((oc) =>
          oc.columns(['transaction_id', 'trainer_id']).doUpdateSet((eb) => ({
            original_transaction_id: eb.ref('excluded.original_transaction_id'),
            product_id: eb.ref('excluded.product_id'),
            purchase_date: eb.ref('excluded.purchase_date'),
            expires_date: eb.ref('excluded.expires_date'),
            web_order_line_item_id: eb.ref('excluded.web_order_line_item_id'),
            is_trial_period: eb.ref('excluded.is_trial_period'),
            is_in_intro_offer_period: eb.ref('excluded.is_in_intro_offer_period'),
            encoded_receipt: eb.ref('excluded.encoded_receipt'),
          }))
        )
        .execute()
    } catch (error: unknown) {
      if (isPgError(error) && error.code === '23505' && error.constraint === 'app_store_transaction_pkey') {
        throw new AppStoreReceiptError('user-conflict')
      }
      throw error
    }

    if (pendingRenewalInfo && pendingRenewalInfo.length > 0 && pendingRenewalInfo.every((info) => info.product_id)) {
      if (pendingRenewalInfo.some((info) => info.auto_renew_status === '0')) {
        await enqueueWorkflowTask(trx, 'updateMailchimpListMemberTags', {
          trainerId,
          tags: [{ name: 'Turned off auto renew', status: 'active' }],
        })
      }

      await trx
        .insertInto('app_store_pending_renewal_info')
        .values(
          pendingRenewalInfo.map((info) => ({
            trainer_id: trainerId,
            product_id: info.product_id,
            data: info as unknown as Json,
          }))
        )
        .onConflict((oc) =>
          oc.columns(['trainer_id', 'product_id']).doUpdateSet((eb) => ({ data: eb.ref('excluded.data') }))
        )
        .execute()
    }
  })
}

const parseApplePayload = (value: unknown): AppleReceiptPayload => {
  if (typeof value === 'object' && value !== null && 'status' in value) {
    return value as AppleReceiptPayload
  }

  throw new AppStoreReceiptError('unexpected', 'Apple response did not include a status code.')
}

const fetchReceiptPayload = async (encodedReceipt: string, sharedSecret: string): Promise<AppleReceiptPayload> => {
  const requestInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': encodedReceipt,
      password: sharedSecret,
      'exclude-old-transactions': false,
    }),
  }

  try {
    const prodResponse = await fetch(APP_STORE_PROD_URL, requestInit)
    if (prodResponse.ok) {
      const payload = parseApplePayload(await prodResponse.json())
      if (Number(payload.status) === 21007) {
        const sandboxResponse = await fetch(APP_STORE_SANDBOX_URL, requestInit)
        if (!sandboxResponse.ok) {
          throw new AppStoreReceiptError('temporary', 'Fetch failed (sandbox)')
        }
        return parseApplePayload(await sandboxResponse.json())
      }
      return payload
    }
    throw new AppStoreReceiptError('temporary', 'Fetch failed')
  } catch (error) {
    if (error instanceof AppStoreReceiptError) {
      throw error
    }
    throw new AppStoreReceiptError('temporary', 'Fetch failed')
  }
}

export const processAppleReceipt = async ({
  trainerId,
  encodedReceipt,
  sharedSecret,
}: {
  trainerId: string
  encodedReceipt: string
  sharedSecret: string
}) => {
  const payload = await fetchReceiptPayload(encodedReceipt, sharedSecret)

  switch (payload.status) {
    case 0: {
      const parsed = successResponseSchema.parse(payload)

      const latestInfo = parsed.latest_receipt_info
        .toSorted((a, b) => {
          const x = a.purchase_date_ms
          const y = b.purchase_date_ms
          if (x > y) {
            return 1
          }
          if (x < y) {
            return -1
          }
          return 0
        })
        .map((receipt) => ({
          ...receipt,
          encoded_receipt: parsed.latest_receipt,
          trainer_id: trainerId,
        }))

      const normalized = latestInfo.map((receipt) => normalizeInAppReceipt(receipt, parsed.latest_receipt, trainerId))

      await insertReceiptData({
        trainerId,
        receipts: normalized,
        pendingRenewalInfo: parsed.pending_renewal_info,
      })

      return parsed
    }
    case 21000:
      throw new AppStoreReceiptError('unexpected', 'The App Store could not read the JSON object you provided.')
    case 21002:
      throw new AppStoreReceiptError('invalid-parameters', 'The receiptData was malformed or missing.')
    case 21003:
      throw new AppStoreReceiptError('unexpected', 'The receipt could not be authenticated.')
    case 21004:
      throw new AppStoreReceiptError(
        'unexpected',
        'The shared secret you provided does not match the shared secret on file for your account.'
      )
    case 21005:
      throw new AppStoreReceiptError('temporary', 'The receipt server is not currently available.')
    case 21007:
      throw new AppStoreReceiptError(
        'unexpected',
        'This receipt is from the test environment, but it was sent to the production environment for verification. Send it to the test environment instead.'
      )
    case 21008:
      throw new AppStoreReceiptError(
        'unexpected',
        'This receipt is from the production environment, but it was sent to the test environment for verification. Send it to the production environment instead.'
      )
    case 21010:
      throw new AppStoreReceiptError(
        'unexpected',
        'This receipt could not be authorized. Treat this the same as if a purchase was never made.'
      )
    default: {
      const status = Number(payload.status)
      if (status >= 21100 && status <= 21199 && payload['is-retryable'] === true) {
        throw new AppStoreReceiptError('temporary', 'App Store internal data access error. Try again.')
      }
      throw new AppStoreReceiptError('unexpected', 'Unexpected App Store response status.')
    }
  }
}
