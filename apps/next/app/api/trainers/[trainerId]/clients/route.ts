import { NextResponse } from 'next/server'
import { db, type Point, type Selectable, type VwLegacyClient } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import { adaptClientRow, clientListSchema } from '../../../clients/shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  trainerId: z.string().uuid({ message: 'trainerId must be a valid UUID' }),
})

type TrainerRouteContext = { params?: Promise<{ trainerId?: string }> }

const querySchema = z.object({
  sessionId: z.string().uuid().optional(),
})

const nullableTrimmedString = z
  .string()
  .trim()
  .transform(value => (value.length === 0 ? null : value))
  .optional()

const createClientSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required'),
  lastName: nullableTrimmedString,
  email: nullableTrimmedString,
  mobileNumber: nullableTrimmedString,
  otherNumber: nullableTrimmedString,
  status: z.enum(['current', 'lead', 'past']).default('current'),
  company: nullableTrimmedString,
  location: nullableTrimmedString,
  address: nullableTrimmedString,
  googlePlaceId: nullableTrimmedString,
  geo: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
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

export async function GET(request: Request, context: TrainerRouteContext) {
  const params = await context?.params
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
    let clientQuery = db
      .selectFrom('vw_legacy_client as client')
      .selectAll('client')
      .where('client.trainerId', '=', auth.trainerId)

    if (sessionId) {
      const sessionClients = db
        .selectFrom('client_session')
        .select('client_session.client_id')
        .where('client_session.session_id', '=', sessionId)
        .as('session_clients')

      clientQuery = clientQuery.innerJoin(
        sessionClients,
        'session_clients.client_id',
        'client.id'
      )
    }

    const clientRows = await clientQuery.execute()
    const clients = clientListSchema.parse(clientRows.map(adaptClientRow))

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

export async function POST(request: Request, context: TrainerRouteContext) {
  const params = await context?.params
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
    const created: Selectable<VwLegacyClient>[] = await db.transaction().execute(async trx => {
      const userRows = await trx
        .insertInto('user_')
        .values(payloads.map(() => ({ type: 'client' })))
        .returning('id')
        .execute()

      if (userRows.length !== payloads.length) {
        throw new Error('Failed to create user records for clients')
      }

      const clientRows = await trx
        .insertInto('client')
        .values(
          payloads.map((client, idx) => {
            const geo: Point | null = client.geo
              ? { x: client.geo.lat, y: client.geo.lng }
              : null

            return {
              user_id: userRows[idx]?.id ?? '',
              user_type: 'client',
              trainer_id: auth.trainerId,
              first_name: client.firstName,
              last_name: client.lastName ?? null,
              email: client.email ?? null,
              mobile_number: client.mobileNumber ?? null,
              other_number: client.otherNumber ?? null,
              status: client.status,
              company: client.company ?? null,
              location: client.location ?? null,
              address: client.address ?? null,
              google_place_id: client.googlePlaceId ?? null,
              geo,
            }
          })
        )
        .returning('id')
        .execute()

      if (clientRows.length !== payloads.length) {
        throw new Error('Failed to create client records')
      }

      const ids = clientRows.map(row => row.id)

      const newClients = await trx
        .selectFrom('vw_legacy_client')
        .selectAll()
        .where('id', 'in', ids)
        .execute()

      return newClients
    })

    const parsed = clientListSchema.parse(created.map(adaptClientRow))

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
