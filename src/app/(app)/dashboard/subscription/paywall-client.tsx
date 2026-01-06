'use client'

import type { ChangeEvent } from 'react'
import { useMemo, useState, useTransition } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { AlertCircle, CheckCircle2, CreditCard, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { startSubscriptionIntent } from './actions'

type SubscriptionPlan = {
  monthlyPrice: string
  yearlyPrice: string
  currency: string
}

type Props = {
  plan: SubscriptionPlan | null
  publishableKey: string | null
  trainerName: string | null
  trialDaysRemaining: number | null
  trialEndsAt: string | null
}

type AddressState = {
  country: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
}

type NormalizedAddress = {
  country: string
  line1: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
}

export function SubscriptionPaywall({ plan, publishableKey, trainerName, trialDaysRemaining, trialEndsAt }: Props) {
  const router = useRouter()
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [address, setAddress] = useState<AddressState>({
    country: 'US',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
  })
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [intentLoading, setIntentLoading] = useState(false)

  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey])

  const normalizedPlan = useMemo(() => {
    if (!plan) return null
    const monthly = Number.parseFloat(plan.monthlyPrice)
    const yearly = Number.parseFloat(plan.yearlyPrice)
    return Number.isFinite(monthly) && Number.isFinite(yearly) ? { monthly, yearly, currency: plan.currency } : null
  }, [plan])

  const savings = useMemo(() => {
    if (!normalizedPlan) return null
    const yearlyAsMonthly = normalizedPlan.yearly / 12
    const diff = normalizedPlan.monthly - yearlyAsMonthly
    const pct = normalizedPlan.monthly > 0 ? Math.max(0, Math.round((diff / normalizedPlan.monthly) * 100)) : 0
    return { diff, pct }
  }, [normalizedPlan])

  const formatCurrency = (value: number) => {
    if (!normalizedPlan || !Number.isFinite(value)) return '—'
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: normalizedPlan.currency,
        maximumFractionDigits: 2,
      }).format(value)
    } catch {
      return `${value.toFixed(2)} ${normalizedPlan.currency}`
    }
  }

  const handleChange = (key: keyof AddressState) => (event: ChangeEvent<HTMLInputElement>) => {
    setAddress((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const normalizedAddress = (): NormalizedAddress => {
    const optional = (value: string) => {
      const trimmed = value.trim()
      return trimmed.length === 0 ? undefined : trimmed
    }

    return {
      country: address.country.trim().slice(0, 2).toUpperCase(),
      line1: address.line1.trim(),
      line2: optional(address.line2),
      city: optional(address.city),
      state: optional(address.state),
      postalCode: optional(address.postalCode),
    }
  }

  const handleCreateIntent = () => {
    setMessage(null)
    setClientSecret(null)

    const payloadAddress = normalizedAddress()
    if (!payloadAddress.line1 || payloadAddress.country.length < 2) {
      setMessage('Please add at least a country code and street address to continue.')
      return
    }

    if (!normalizedPlan) {
      setMessage('Subscription pricing is unavailable. Please try again.')
      return
    }

    if (!publishableKey) {
      setMessage('Payments are currently unavailable. Contact support if this continues.')
      return
    }

    startTransition(async () => {
      setIntentLoading(true)
      try {
        const result = await startSubscriptionIntent({
          interval,
          address: payloadAddress,
        })

        if (!result.ok) {
          setMessage(result.message)
          return
        }

        setClientSecret(result.clientSecret)
        setMessage(null)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Something went wrong starting your subscription.'
        setMessage(reason)
      } finally {
        setIntentLoading(false)
      }
    })
  }

  const resetIntent = () => {
    setClientSecret(null)
    setMessage(null)
  }

  const trialCopy = (() => {
    if (trialDaysRemaining && trialDaysRemaining > 0) return `${trialDaysRemaining} day trial remaining`
    if (trialEndsAt) return `Trial ends ${new Date(trialEndsAt).toLocaleDateString()}`
    return 'Trial ending soon'
  })()

  return (
    <Card className="border border-border/60 shadow-lg">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          Secure checkout
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4" aria-hidden />
          {trialCopy}
          <span className="h-4 w-px bg-border" aria-hidden />
          <CreditCard className="size-4" aria-hidden />
          Stripe processes your payment details.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Choose billing</p>
              <p className="text-lg font-semibold text-foreground">
                {interval === 'month'
                  ? formatCurrency(normalizedPlan?.monthly ?? Number.NaN)
                  : formatCurrency(normalizedPlan?.yearly ?? Number.NaN)}
              </p>
            </div>
            <div className="flex rounded-full border border-border/70 p-1 shadow-xs">
              {['month', 'year'].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={interval === value ? 'default' : 'ghost'}
                  size="sm"
                  className={cn('rounded-full px-3', interval === value ? 'shadow-sm' : '')}
                  onClick={() => {
                    setInterval(value as 'month' | 'year')
                    resetIntent()
                  }}
                  disabled={isPending}
                >
                  {value === 'month' ? 'Monthly' : 'Yearly'}
                </Button>
              ))}
            </div>
          </div>
          {savings && savings.pct > 0 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Save {savings.pct}% when billed yearly ({formatCurrency(savings.diff)} per month)
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="country">Country (2 letters)</Label>
              <Input
                id="country"
                name="country"
                value={address.country}
                onChange={handleChange('country')}
                maxLength={2}
                placeholder="US"
                autoCapitalize="characters"
                disabled={isPending || Boolean(clientSecret)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal">Postal code</Label>
              <Input
                id="postal"
                name="postal"
                value={address.postalCode}
                onChange={handleChange('postalCode')}
                placeholder="12345"
                disabled={isPending || Boolean(clientSecret)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="line1">Street address</Label>
            <Input
              id="line1"
              name="line1"
              value={address.line1}
              onChange={handleChange('line1')}
              placeholder="123 Main St"
              disabled={isPending || Boolean(clientSecret)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="line2">Apartment / suite (optional)</Label>
            <Input
              id="line2"
              name="line2"
              value={address.line2}
              onChange={handleChange('line2')}
              placeholder="Suite 5"
              disabled={isPending || Boolean(clientSecret)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                value={address.city}
                onChange={handleChange('city')}
                placeholder="City"
                disabled={isPending || Boolean(clientSecret)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State / region</Label>
              <Input
                id="state"
                name="state"
                value={address.state}
                onChange={handleChange('state')}
                placeholder="CA"
                disabled={isPending || Boolean(clientSecret)}
              />
            </div>
          </div>
        </section>

        {message ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4" aria-hidden />
            <p>{message}</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {publishableKey && stripePromise ? (
            clientSecret ? (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: { theme: 'stripe' },
                }}
              >
                <StripePaymentForm
                  trainerName={trainerName}
                  address={normalizedAddress()}
                  onBack={resetIntent}
                  onSuccess={() => router.replace('/dashboard')}
                />
              </Elements>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
                Enter your billing address then choose “Load payment form” to add card details securely.
              </div>
            )
          ) : (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Payments are unavailable. Please contact support.
            </div>
          )}
        </div>

        {!clientSecret ? (
          <Button
            type="button"
            className="w-full"
            onClick={handleCreateIntent}
            disabled={isPending || intentLoading || !plan}
          >
            {isPending || intentLoading ? 'Loading payment form…' : 'Load payment form'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StripePaymentForm({
  trainerName,
  address,
  onBack,
  onSuccess,
}: {
  trainerName: string | null
  address: NormalizedAddress
  onBack: () => void
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined,
        payment_method_data: {
          billing_details: {
            name: trainerName ?? undefined,
            address: {
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              state: address.state,
              postal_code: address.postalCode,
              country: address.country,
            },
          },
        },
      },
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed. Please try again.')
      setSubmitting(false)
      return
    }

    const status = paymentIntent?.status
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      onSuccess()
      return
    }

    setError(`Payment status: ${status ?? 'unknown'}`)
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Payment details</p>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
          Edit details
        </Button>
      </div>
      <div className="rounded-lg border border-border/70 p-3">
        <PaymentElement options={{ readOnly: submitting }} />
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4" aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}

      <Button type="button" className="w-full" onClick={handleConfirm} disabled={submitting || !stripe || !elements}>
        {submitting ? 'Confirming…' : 'Confirm and subscribe'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        You will be charged securely via Stripe. You can manage or cancel anytime in Settings.
      </p>
    </div>
  )
}
