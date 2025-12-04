import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from '../shared'

const paramsSchema = z.object({
  planId: z.string().trim().min(1, 'planId must not be empty'),
})

type HandlerContext = RouteContext<'/api/plans/[planId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid route parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching plan',
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
