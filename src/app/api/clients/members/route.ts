import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'

const querySchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be a valid email address.'),
})

const dbRowSchema = z.object({
  id: z.string(),
  trainerFirstName: z.string(),
  trainerLastName: z.string().nullable(),
  clientFirstName: z.string(),
  clientLastName: z.string().nullable(),
})

const responseSchema = z.array(
  z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    clientFirstName: z.string(),
    clientLastName: z.string().nullable(),
  })
)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsedQuery = querySchema.safeParse({
    email: url.searchParams.get('email'),
  })

  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const { email } = parsedQuery.data

  try {
    const rows = await db
      .selectFrom('client')
      .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
      .innerJoin('user_', (join) =>
        join.onRef('user_.id', '=', 'client.user_id').onRef('user_.type', '=', 'client.user_type')
      )
      .select((eb) => [
        eb.ref('user_.id').as('id'),
        eb.ref('trainer.first_name').as('trainerFirstName'),
        eb.ref('trainer.last_name').as('trainerLastName'),
        eb.ref('client.first_name').as('clientFirstName'),
        eb.ref('client.last_name').as('clientLastName'),
      ])
      .where('client.email', '=', email)
      .execute()

    const parsedRows = dbRowSchema.array().parse(rows)

    if (parsedRows.length === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail: 'No client exists with the provided email address.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = responseSchema.parse(
      parsedRows.map((row) => ({
        id: row.id,
        firstName: row.trainerFirstName,
        lastName: row.trainerLastName,
        clientFirstName: row.clientFirstName,
        clientLastName: row.clientLastName,
      }))
    )

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client member data from database',
          detail: 'Client member data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to list client members', { email, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to list client members',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
