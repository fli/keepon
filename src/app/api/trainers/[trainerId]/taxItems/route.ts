import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'

const responseSchema = z.array(z.unknown())

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/taxItems'>

export async function GET(request: NextRequest, context: HandlerContext) {
  void context

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching tax items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const emptyResponse = responseSchema.parse([])

  return NextResponse.json(emptyResponse)
}
