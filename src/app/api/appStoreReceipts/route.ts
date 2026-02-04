import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, type Json } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'

const APP_STORE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt'
const APP_STORE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt'

const requestSchema = z.object({
  receiptData: z.string().trim().min(1, 'receiptData is required'),
})

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

type SuccessReceiptPayload = z.infer<typeof successResponseSchema>
type PendingRenewalInfo = z.infer<typeof pendingRenewalInfoSchema>
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

class AppStoreReceiptError extends Error {
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

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createMissingSecretResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'App Store shared secret is not configured',
      detail: 'Set APP_STORE_SHARED_SECRET in the environment to verify receipts.',
      type: '/app-store-receipt-misconfigured',
    }),
    { status: 500 }
  )

const createInvalidParametersResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail: detail ?? 'The receiptData was malformed or missing.',
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const createUserConflictResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'This receipt has already been processed for another user.',
      type: '/app-store-receipt-user-conflict',
    }),
    { status: 409 }
  )

const createTemporaryServerProblemResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 503,
      title: 'Something went wrong while verifying your receipt with Apple. Try again.',
      detail,
      type: '/app-store-receipt-temporary-server-problem',
    }),
    { status: 503 }
  )

const createUnexpectedServerIssueResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something went wrong while verifying your receipt with Apple.',
      detail,
      type: '/app-store-receipt-unexpected-server-issue',
    }),
    { status: 500 }
  )

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
  } catch (error) {
    if (error instanceof AppStoreReceiptError) {
      throw error
    }
    console.error('Failed to reach Apple receipt verification endpoint', error)
    throw new AppStoreReceiptError('temporary', 'Fetch failed')
  }

  throw new AppStoreReceiptError('temporary', 'Fetch failed')
}

const processReceipt = async ({
  encodedReceipt,
  trainerId,
  sharedSecret,
}: {
  encodedReceipt: string
  trainerId: string
  sharedSecret: string
}): Promise<SuccessReceiptPayload> => {
  const payload = await fetchReceiptPayload(encodedReceipt, sharedSecret)

  const status = Number(payload?.status)

  switch (status) {
    case 0: {
      const parsed = successResponseSchema.safeParse(payload)
      if (!parsed.success) {
        console.error('Unexpected receipt payload shape from Apple', {
          issues: parsed.error.issues,
        })
        throw new AppStoreReceiptError('unexpected', 'Receipt payload missing expected fields.')
      }

      const { latest_receipt_info, latest_receipt, pending_renewal_info } = parsed.data

      const sortedReceipts = [...latest_receipt_info].sort(
        (a, b) => Number(a.purchase_date_ms) - Number(b.purchase_date_ms)
      )

      const normalizedReceipts = sortedReceipts.map((receipt) =>
        normalizeInAppReceipt(receipt, latest_receipt, trainerId)
      )

      await insertReceiptData({
        trainerId,
        receipts: normalizedReceipts,
        pendingRenewalInfo: pending_renewal_info,
      })

      return parsed.data
    }
    case 21000:
      throw new AppStoreReceiptError('unexpected', 'The App Store could not read the JSON object you provided.')
    case 21002:
      throw new AppStoreReceiptError('invalid-parameters', 'The receiptData was malformed or missing.')
    case 21003:
      throw new AppStoreReceiptError('unexpected', 'The receipt could not be authenticated.')
    case 21004:
      throw new AppStoreReceiptError('unexpected', 'The shared secret does not match the expected value.')
    case 21005:
      throw new AppStoreReceiptError('temporary', 'The receipt server is not currently available.')
    case 21007:
      throw new AppStoreReceiptError('unexpected', 'Test receipt was sent to the production environment.')
    case 21008:
      throw new AppStoreReceiptError('unexpected', 'Production receipt was sent to the sandbox environment.')
    case 21010:
      throw new AppStoreReceiptError('unexpected', 'This receipt could not be authorized.')
    default: {
      if (status >= 21100 && status <= 21199) {
        if (payload?.['is-retryable'] === true) {
          throw new AppStoreReceiptError('temporary', 'App Store internal data access error. Try again.')
        }
        throw new AppStoreReceiptError('unexpected', 'App Store internal data access error.')
      }

      throw new AppStoreReceiptError('unexpected', 'Payload has invalid status code.')
    }
  }
}

export async function POST(request: Request) {
  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }
  const body = parsedJson.data

  const parsedBody = requestSchema.safeParse(body)
  if (!parsedBody.success) {
    const detail = parsedBody.error.issues.map((issue) => issue.message).join('; ')
    return createInvalidBodyResponse(detail || undefined)
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while verifying App Store receipt',
  })

  if (!auth.ok) {
    return auth.response
  }

  const sharedSecret = process.env.APP_STORE_SHARED_SECRET
  if (!sharedSecret) {
    console.error('APP_STORE_SHARED_SECRET is not set in the environment')
    return createMissingSecretResponse()
  }

  try {
    const result = await processReceipt({
      encodedReceipt: parsedBody.data.receiptData,
      trainerId: auth.trainerId,
      sharedSecret,
    })

    return NextResponse.json(result.receipt)
  } catch (error) {
    if (error instanceof AppStoreReceiptError) {
      switch (error.kind) {
        case 'invalid-parameters':
          return createInvalidParametersResponse(error.message)
        case 'user-conflict':
          return createUserConflictResponse()
        case 'temporary':
          return createTemporaryServerProblemResponse(error.message)
        case 'unexpected':
        default:
          return createUnexpectedServerIssueResponse(error.message)
      }
    }

    console.error('Unexpected error while processing App Store receipt', {
      error,
      trainerId: auth.trainerId,
    })
    return createUnexpectedServerIssueResponse()
  }
}
