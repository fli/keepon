import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { getTrainerProfile } from '@/server/trainerProfile'

type HandlerContext = RouteContext<'/api/trainers/[trainerId]'>

const paramsSchema = z.object({
  trainerId: z.string().uuid({ message: 'trainerId must be a valid UUID' }),
})

const shouldIncludeSessionSeries = (url: URL) => {
  const include = (value: string | null) => value?.trim().toLowerCase() ?? ''
  return (
    include(url.searchParams.get('filter[include]')) === 'sessionseries' ||
    include(url.searchParams.get('filter[include][relation]')) === 'sessionseries'
  )
}

export async function GET(request: NextRequest, context: HandlerContext) {
  const params = await context.params
  const parsedParams = paramsSchema.safeParse(params ?? {})

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')
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

  const includeSessionSeries = shouldIncludeSessionSeries(new URL(request.url))

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching trainer profile',
  })

  if (!auth.ok) {
    return auth.response
  }

  if (auth.trainerId !== parsedParams.data.trainerId) {
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

  try {
    const trainer = await getTrainerProfile(auth.trainerId, { includeSessionSeries })

    if (!trainer) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'No trainer exists for the authenticated token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    return NextResponse.json(trainer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data from database',
          detail: 'Trainer data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer profile', {
      trainerId: auth.trainerId,
      includeSessionSeries,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch trainer',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
