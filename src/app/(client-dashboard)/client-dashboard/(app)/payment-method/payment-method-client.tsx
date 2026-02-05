'use client'

import type { StripeCardElement as StripeCardElementType } from '@stripe/stripe-js'
import { useStripe } from '@stripe/react-stripe-js'
import { Lock, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { createStripeSetupIntent } from '@/app/(client-dashboard)/client-dashboard/actions'
import { Alert } from '@/components/client-dashboard/Alert'
import { CardDetails } from '@/components/client-dashboard/CardDetails'
import { StripeCardElement } from '@/components/client-dashboard/StripeCardElement'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export type PaymentMethodClientProps = {
  card: {
    last4: string
    expYear: number
    expMonth: number
    brand: string
  } | null
}

export function PaymentMethodClient({ card }: PaymentMethodClientProps) {
  const stripe = useStripe()
  const router = useRouter()
  const [cardElement, setCardElement] = useState<StripeCardElementType | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setSuccess(false)

    if (!stripe || !cardElement) {
      setMessage('Please enter your card details to continue.')
      return
    }

    startTransition(async () => {
      const setupIntent = await createStripeSetupIntent()
      if (!setupIntent.ok) {
        setMessage(setupIntent.message)
        return
      }

      const result = await stripe.confirmCardSetup(setupIntent.clientSecret, {
        payment_method: { card: cardElement },
      })

      if (result.error) {
        setMessage(result.error.message ?? 'Unable to save this card. Please try again.')
        return
      }

      cardElement.clear()
      setSuccess(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your card details</CardTitle>
          <CardDescription>We will use this card for subscriptions and approved payments.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {success ? <Alert tone="success" title="Card saved successfully." /> : null}
          {message ? <Alert tone="error" title={message} /> : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Card on file</p>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <CardDetails card={card} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="card-details" className="text-sm font-medium text-foreground">
              New card details
            </label>
            <StripeCardElement id="card-details" onReady={setCardElement} />
            <p className="text-xs text-muted-foreground">
              By adding your card details you agree to Keepon's{' '}
              <a className="underline" href="https://getkeepon.com/terms-of-service" target="_blank" rel="noreferrer">
                terms and conditions
              </a>
              . Your service provider can not charge you without your consent.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!stripe || !cardElement || isPending}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Lock className="size-4" aria-hidden />
            )}
            Save card
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
