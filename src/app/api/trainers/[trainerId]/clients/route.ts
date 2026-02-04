import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClientForTrainer, createClientSchema, listClientsForTrainer } from '@/server/clients'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { clientListSchema } from '../../../clients/shared'

type TrainerRouteContext = RouteContext<'/api/trainers/[trainerId]/clients'>

const querySchema = z.object({
  sessionId: z.string().uuid().optional(),
})

const createClientsSchema = z.union([createClientSchema, z.array(createClientSchema)])

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const invalidParametersResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail,
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const isValidStatus = (value: unknown): value is 'current' | 'past' | 'lead' =>
  value === 'current' || value === 'past' || value === 'lead'

const buildLegacyCreateClientDetail = (payload: unknown) => {
  const suffix = '\nor  should be Array<unknown>'
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ` should be Record<string, unknown>${suffix}`
  }

  const body = payload as Record<string, unknown>
  const hasFirstName = Object.hasOwn(body, 'firstName')
  const hasStatus = Object.hasOwn(body, 'status')

  if (!hasFirstName && !hasStatus) {
    return `firstName  not provided status  not provided${suffix}`
  }
  if (!hasFirstName) {
    return ` firstName  not provided${suffix}`
  }
  if (!hasStatus) {
    return ` status  not provided${suffix}`
  }

  if (typeof body.firstName !== 'string') {
    return ` firstName  should be string${suffix}`
  }

  if (!isValidStatus(body.status)) {
    return ` status  should be "current" | "past" | "lead"${suffix}`
  }

  if (Object.hasOwn(body, 'birthday')) {
    const birthday = body.birthday
    if (birthday !== null) {
      if (typeof birthday !== 'string') {
        return ` birthday  should be string${suffix}`
      }
      const trimmed = birthday.trim()
      if (trimmed.length > 0) {
        return ` birthday should not be provided or  should be is a valid date string or  should be is a valid datetime string${suffix}`
      }
    }
  }

  if (Object.hasOwn(body, 'email')) {
    const email = body.email
    if (email !== null) {
      if (typeof email !== 'string') {
        return ` email should not be provided or  should be email${suffix}`
      }
      const trimmed = email.trim()
      if (trimmed.length > 0 && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
        return ` email should not be provided or  should be email${suffix}`
      }
    }
  }

  return ` should be Record<string, unknown>${suffix}`
}

export async function GET(request: NextRequest, context: TrainerRouteContext) {
  void context

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({
    sessionId: url.searchParams.get('sessionId') ?? undefined,
  })

  if (!queryResult.success) {
    const detail = queryResult.error.issues.map((issue) => issue.message).join('; ')
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching trainer clients',
  })

  if (!auth.ok) {
    return auth.response
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
  void context

  let rawBody: unknown = {}
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawBodyText)
    } catch (error) {
      console.error('Failed to parse client create request body', error)
      return createLegacyInvalidJsonResponse()
    }
  }

  if (rawBody === null || (typeof rawBody !== 'object' && !Array.isArray(rawBody))) {
    return createLegacyInvalidJsonResponse()
  }

  if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    if (Object.hasOwn(rawBody, 'birthday')) {
      const birthday = (rawBody as Record<string, unknown>).birthday
      if (birthday !== null && typeof birthday !== 'string') {
        return invalidParametersResponse(buildLegacyCreateClientDetail(rawBody))
      }
    }
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating clients',
  })

  if (!auth.ok) {
    return auth.response
  }

  let parsedBody: z.infer<typeof createClientsSchema>

  const validation = createClientsSchema.safeParse(rawBody)
  if (!validation.success) {
    const detail = buildLegacyCreateClientDetail(rawBody)
    return invalidParametersResponse(detail)
  }
  parsedBody = validation.data

  const payloads = Array.isArray(parsedBody) ? parsedBody : [parsedBody]

  try {
    const created = await Promise.all(payloads.map((payload) => createClientForTrainer(auth.trainerId, payload)))

    const parsed = clientListSchema.parse(created)

    return NextResponse.json(Array.isArray(parsedBody) ? parsed : parsed[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = buildLegacyCreateClientDetail(parsedBody)
      return invalidParametersResponse(detail)
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
