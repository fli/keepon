import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { getDashboardSummary } from '@/server/dashboard'
import type { DashboardSummary } from '@/server/dashboard'

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching dashboard summary',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { trainerId, userId } = authorization

  try {
    const responseBody: DashboardSummary = await getDashboardSummary(
      trainerId,
      userId
    )
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues
        .map(issue => `${issue.path.join('.') || 'field'}: ${issue.message}`)
        .join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse dashboard data',
          detail: detail || 'Dashboard data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to build dashboard summary', {
      trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to build dashboard summary',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
