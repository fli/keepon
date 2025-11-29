import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from '../shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  planId: z
    .string()
    .trim()
    .min(1, 'planId must not be empty'),
})

type RouteContext = {
  params: {
    planId?: string | string[]
  }
}

export async function GET(request: Request, context: RouteContext) {
  const rawPlanId = Array.isArray(context.params?.planId)
    ? context.params?.planId[0]
    : context.params?.planId

  const parsedParams = paramsSchema.safeParse({
    planId: rawPlanId,
  })

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid route parameters',
        detail:
          detail ||
          'Request path parameters did not match the expected schema.',
        type: '/invalid-path',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching plan',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = await db
      .selectFrom('vw_legacy_plan as v')
      .selectAll('v')
      .where('v.trainerId', '=', authorization.trainerId)
      .where('v.id', '=', parsedParams.data.planId)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Plan not found',
          detail: 'Plan not found or you do not have access to it.',
          type: '/plan-not-found',
        }),
        { status: 404 }
      )
    }

    const plan = normalizePlanRow(row as RawPlanRow)

    return NextResponse.json(plan)
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

    console.error('Failed to fetch plan', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch plan',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
