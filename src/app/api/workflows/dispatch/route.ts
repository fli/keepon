import { NextResponse } from 'next/server'
import { dispatchOutboxOnce } from '@/server/workflow/dispatcher'

export const runtime = 'nodejs'
export const maxDuration = 30

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const getDispatchTokens = () =>
  [process.env.WORKFLOW_OUTBOX_DISPATCH_SECRET, process.env.CRON_SECRET].filter((value): value is string =>
    Boolean(value && value.trim())
  )

const isAuthorized = (request: Request) => {
  const tokens = getDispatchTokens()
  if (tokens.length === 0) {
    return true
  }

  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken && tokens.includes(queryToken)) {
    return true
  }

  const authorization = request.headers.get('authorization') ?? ''
  const bearerPrefix = 'Bearer '
  if (authorization.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim()
    return tokens.includes(token)
  }

  return false
}

const handleDispatchRequest = async (request: Request) => {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        status: 'unauthorized',
      },
      { status: 401 }
    )
  }

  const url = new URL(request.url)
  const limit = parsePositiveInt(url.searchParams.get('limit'), 20)

  const result = await dispatchOutboxOnce({
    workerId: 'api:dispatch',
    limit,
    reason: 'api',
  })

  return NextResponse.json({
    status: 'ok',
    ...result,
  })
}

export async function GET(request: Request) {
  return handleDispatchRequest(request)
}

export async function POST(request: Request) {
  return handleDispatchRequest(request)
}
