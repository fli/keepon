import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { login, loginRequestSchema } from '@/server/auth'

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

  const parsed = loginRequestSchema.safeParse(parsedJson.data)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    return invalidBodyResponse(detail || undefined)
  }

  try {
    const result = await login(parsed.data)
    const responseBody = responseSchema.parse(result)
    return NextResponse.json(responseBody)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sign in'
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Failed to sign in',
        detail: message,
        type: '/login-failed',
      }),
      { status: 400 }
    )
  }
}
