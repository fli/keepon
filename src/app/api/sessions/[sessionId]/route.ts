import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { adaptSessionRow, RawSessionRow } from '../shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .min(1, 'sessionId must not be empty'),
})

type ParamsContext = {
  params?: {
    sessionId?: string
  }
}

export async function GET(request: Request, context: ParamsContext) {
  const parsedParams = paramsSchema.safeParse(context?.params ?? {})

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId } = parsedParams.data

  try {
    const row = (await db
      .selectFrom('vw_legacy_session_2 as v')
      .innerJoin('session as s', 's.id', 'v.id')
      .selectAll('v')
      .where('v.id', '=', sessionId)
      .where('s.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()) as RawSessionRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          detail: 'No appointment exists with the provided identifier.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const session = adaptSessionRow(row)

    return NextResponse.json(session)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session data from database',
          detail: 'Session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch session', sessionId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
