'use client'

import type { Route } from 'next'
import { Building2, Loader2, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import {
  createClientDashboardSession,
  listClientLogins,
  requestClientLoginCode,
  type ClientLoginChoice,
} from '@/app/(client-dashboard)/client-dashboard/actions'
import { Alert } from '@/components/client-dashboard/Alert'
import { KeeponLogo } from '@/components/keepon-logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const defaultInfoMessage = 'We sent a temporary login code to your email. Enter it below to continue.'

type Stage = 'email' | 'code' | 'pick'

type LoginClientProps = {
  redirectTo?: string | null
  initialEmail?: string
}

const safeRedirect = (value?: string | null) => {
  if (value && value.startsWith('/client-dashboard')) {
    return value
  }
  return '/client-dashboard'
}

export function LoginClient({ redirectTo, initialEmail = '' }: LoginClientProps) {
  const router = useRouter()
  const codeRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [clients, setClients] = useState<ClientLoginChoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (stage === 'code') {
      codeRef.current?.focus()
    }
  }, [stage])

  const resetToEmail = () => {
    setStage('email')
    setCode('')
    setClients([])
    setError(null)
    setInfo(null)
  }

  const handleRequestCode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    startTransition(async () => {
      const result = await requestClientLoginCode({ email })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStage('code')
      setInfo(defaultInfoMessage)
    })
  }

  const finalizeLogin = (clientId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await createClientDashboardSession({
        email,
        code,
        clientId,
        redirectTo: redirectTo ?? null,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.replace(safeRedirect(result.redirectTo) as Route)
    })
  }

  const handleVerifyCode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    startTransition(async () => {
      const result = await listClientLogins({ email, code })
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.clients.length === 1) {
        finalizeLogin(result.clients[0].id)
        return
      }
      setClients(result.clients)
      setStage('pick')
    })
  }

  const headerDescription = useMemo(() => {
    if (stage === 'pick') {
      return 'Select the service provider you want to view.'
    }
    return 'Manage your payments and subscriptions securely.'
  }, [stage])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white">
          <KeeponLogo className="h-6 w-auto" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-white/70 uppercase">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
          <p className="text-sm text-white/70">{headerDescription}</p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/5 text-white shadow-xl shadow-slate-950/30">
        <CardHeader>
          <CardTitle>{stage === 'pick' ? 'Choose your dashboard' : 'Sign in with email'}</CardTitle>
          <CardDescription className="text-white/70">
            {stage === 'pick'
              ? 'Pick the profile that matches your service provider.'
              : 'We will send you a temporary code to access your dashboard.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {info ? <Alert tone="success" title={info} /> : null}
          {error ? <Alert tone="error" title={error} /> : null}

          {stage === 'email' ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <label className="space-y-2 text-sm text-white/80" htmlFor="email">
                Email address
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <Button type="submit" size="lg" className="w-full" disabled={isPending || !email.trim()}>
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Email me a code
              </Button>
            </form>
          ) : null}

          {stage === 'code' ? (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <label className="space-y-2 text-sm text-white/80" htmlFor="code">
                Temporary login code
                <Input
                  ref={codeRef}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter the 6-digit code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <Button type="submit" size="lg" className="w-full" disabled={isPending || !code.trim()}>
                {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Continue
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={resetToEmail}>
                Use a different email
              </Button>
            </form>
          ) : null}

          {stage === 'pick' ? (
            <div className="space-y-3">
              {clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => finalizeLogin(client.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm transition hover:bg-white/10"
                  disabled={isPending}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-white">
                      <Building2 className="size-4 text-white/70" aria-hidden />
                      <span className="font-medium">
                        {client.serviceProviderFirstName} {client.serviceProviderLastName ?? ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-white/70">
                      <User className="size-4" aria-hidden />
                      <span>
                        {client.firstName} {client.lastName ?? ''}
                      </span>
                    </div>
                  </div>
                  {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                </button>
              ))}
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={resetToEmail}>
                Use a different email
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-white/60">
        Trouble signing in? Email{' '}
        <a className="underline" href="mailto:enquiry@getkeepon.com">
          enquiry@getkeepon.com
        </a>
      </p>
    </div>
  )
}
