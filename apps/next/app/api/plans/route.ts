import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@keepon/db'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from './shared'

export const runtime = 'nodejs'

const querySchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'clientId must not be empty')
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const queryParams = {
    clientId: url.searchParams.get('clientId')?.trim() || undefined,
  }

  const parsedQuery = querySchema.safeParse(queryParams)
  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail ||
          'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching plans',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const { clientId } = parsedQuery.data

    let query = db
      .selectFrom('vw_legacy_plan as v')
      .selectAll('v')
      .where('v.trainerId', '=', authorization.trainerId)

    if (clientId) {
      query = query.where('v.clientId', '=', clientId)
    }

    const rows = (await query
      .orderBy('v.startDate', 'desc')
      .execute()) as RawPlanRow[]

    const plans = rows.map(normalizePlanRow)

    return NextResponse.json(plans)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse plan data from database',
          detail: 'Plan data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch plans', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch plans',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
