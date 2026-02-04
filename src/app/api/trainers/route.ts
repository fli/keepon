import { NextResponse } from 'next/server'
import { z } from 'zod'

import { buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'
import { createTrainerAccount, trainerSignupSchema } from '@/server/trainers'

const responseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

export async function POST(request: Request) {
  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }
  const body = parsedJson.data

  const parsed = trainerSignupSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    return invalidBodyResponse(detail || undefined)
  }

  try {
    const result = await createTrainerAccount(parsed.data)
    return NextResponse.json(responseSchema.parse(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create account'
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Failed to create account',
        detail: message,
        type: '/create-account-failed',
      }),
      { status: 400 }
    )
  }
}
