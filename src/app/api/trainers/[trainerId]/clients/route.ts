import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import {
  createClientForTrainer,
  createClientSchema,
  listClientsForTrainer,
} from '@/server/clients'
import { clientListSchema } from '../../../clients/shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  trainerId: z.string().uuid({ message: 'trainerId must be a valid UUID' }),
})

type TrainerRouteContext = RouteContext<'/api/trainers/[trainerId]/clients'>

const querySchema = z.object({
  sessionId: z.string().uuid().optional(),
})

const createClientsSchema = z.union([createClientSchema, z.array(createClientSchema)])

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Body did not match expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

export async function GET(request: NextRequest, context: TrainerRouteContext) {
  const params = await context.params
  const paramsResult = paramsSchema.safeParse(params ?? {})
  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid trainer identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({
    sessionId: url.searchParams.get('sessionId') ?? undefined,
  })

  if (!queryResult.success) {
    const detail = queryResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || undefined,
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching trainer clients',
  })

  if (!auth.ok) {
    return auth.response
  }

  if (auth.trainerId !== paramsResult.data.trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'Token does not match requested trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  const { sessionId } = queryResult.data

  try {
    const clients = await listClientsForTrainer(auth.trainerId, sessionId)
    return NextResponse.json(clients)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client data from database',
          detail: 'Client data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer clients', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch clients',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, context: TrainerRouteContext) {
  const params = await context.params
  const paramsResult = paramsSchema.safeParse(params ?? {})
  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid trainer identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating clients',
  })

  if (!auth.ok) {
    return auth.response
  }

  if (auth.trainerId !== paramsResult.data.trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'Token does not match requested trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  let parsedBody: z.infer<typeof createClientsSchema>

  try {
    const json: unknown = await request.json()
    const validation = createClientsSchema.safeParse(json)
    if (!validation.success) {
      const detail = validation.error.issues.map(issue => issue.message).join('; ')
      return invalidBodyResponse(detail)
    }
    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse client create request body', error)
    return invalidJsonResponse()
  }

  const payloads = Array.isArray(parsedBody) ? parsedBody : [parsedBody]

  try {
    const created = await Promise.all(
      payloads.map(payload => createClientForTrainer(auth.trainerId, payload))
    )

    const parsed = clientListSchema.parse(created)

    return NextResponse.json(Array.isArray(parsedBody) ? parsed : parsed[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map(issue => issue.message).join('; ')
      return invalidBodyResponse(detail)
    }

    console.error('Failed to create clients', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create clients',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
