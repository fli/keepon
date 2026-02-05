'use client'

import type { Route } from 'next'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { setClientDashboardCookieFromToken } from '@/app/(client-dashboard)/client-dashboard/actions'
import { Alert } from '@/components/client-dashboard/Alert'
import { KeeponLogo } from '@/components/keepon-logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const safeRedirect = (value?: string | null) => {
  if (value && value.startsWith('/client-dashboard')) {
    return value
  }
  return '/client-dashboard'
}

type LinkClientProps = {
  redirectTo?: string | null
}

const parseDashboardHash = (hash: string) => {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash
  if (!cleaned) {
    return { ok: false as const, message: 'Missing login link data.' }
  }
  const [pathPart, queryPart] = cleaned.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length < 3 || segments[0] !== 'client') {
    return { ok: false as const, message: 'This login link is not valid.' }
  }
  const clientId = segments[1]
  const token = segments[2]
  if (!clientId || !token) {
    return { ok: false as const, message: 'This login link is missing required information.' }
  }
  return { ok: true as const, clientId, token, query: queryPart ?? '' }
}

export function LinkClient({ redirectTo }: LinkClientProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) {
      return
    }
    hasRun.current = true

    startTransition(async () => {
      const parsed = parseDashboardHash(window.location.hash)
      if (!parsed.ok) {
        setError(parsed.message)
        return
      }

      const result = await setClientDashboardCookieFromToken({
        token: parsed.token,
        clientId: parsed.clientId,
      })

      if (!result.ok) {
        setError(result.message)
        return
      }

      router.replace(safeRedirect(redirectTo) as Route)
    })
  }, [redirectTo, router, startTransition])

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white">
          <KeeponLogo className="h-6 w-auto" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-white/70 uppercase">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-white">Signing you in</h1>
          <p className="text-sm text-white/70">We are validating your secure link.</p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/5 text-white shadow-xl shadow-slate-950/30">
        <CardHeader>
          <CardTitle>Hold on a moment</CardTitle>
          <CardDescription className="text-white/70">This should only take a few seconds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert tone="error" title={error} description="Please request a new login link or enter a code." />
          ) : (
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Validating your link
            </div>
          )}

          {error ? (
            <Button
              size="lg"
              variant="outline"
              className="w-full border-white/20 text-white hover:bg-white/10"
              onClick={() => router.replace('/client-dashboard/login' as Route)}
            >
              Go to login
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Continue
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
