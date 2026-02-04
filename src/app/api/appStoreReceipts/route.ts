import { NextResponse } from 'next/server'
import { z } from 'zod'
import { processAppleReceipt, AppStoreReceiptError } from '@/server/appStore/receipts'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'

const requestSchema = z.object({
  receiptData: z.string().trim().min(1, 'receiptData is required'),
})

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
    const result = await processAppleReceipt({
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
