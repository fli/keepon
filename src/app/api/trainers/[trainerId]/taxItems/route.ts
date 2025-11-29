import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const responseSchema = z.array(z.unknown())

type RouteContext = {
  params?: {
    trainerId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching tax items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to access tax items for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  const emptyResponse = responseSchema.parse([])

  return NextResponse.json(emptyResponse)
}
