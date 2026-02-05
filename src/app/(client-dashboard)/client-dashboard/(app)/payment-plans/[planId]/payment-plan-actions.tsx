'use client'

import type { StripeCardElement as StripeCardElementType } from '@stripe/stripe-js'
import { useStripe } from '@stripe/react-stripe-js'
import { CreditCard, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import {
  acceptPaymentPlan,
  createStripeSetupIntent,
  retryPaymentPlan,
} from '@/app/(client-dashboard)/client-dashboard/actions'
import { Alert } from '@/components/client-dashboard/Alert'
import { CardDetails } from '@/components/client-dashboard/CardDetails'
import { StripeCardElement } from '@/components/client-dashboard/StripeCardElement'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cardIsExpired } from '@/lib/client-dashboard/format'

export type PaymentPlanActionsProps = {
  planId: string
  requiresAcceptance: boolean
  hasOverdue: boolean
  amountOverdueLabel?: string | null
  clientCard: {
    paymentMethodId?: string
    last4: string
    expYear: number
    expMonth: number
    brand: string
  } | null
}

export function PaymentPlanActions({
  planId,
  requiresAcceptance,
  hasOverdue,
  amountOverdueLabel,
  clientCard,
}: PaymentPlanActionsProps) {
  const stripe = useStripe()
  const router = useRouter()
  const [cardElement, setCardElement] = useState<StripeCardElementType | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const actionLabel = requiresAcceptance ? 'Accept subscription' : hasOverdue ? 'Pay overdue balance' : 'Retry payment'

  const handleAction = async (useNewCard: boolean) => {
    setMessage(null)

    if (!stripe && useNewCard) {
      setMessage({ tone: 'error', text: 'Stripe is not ready yet. Please try again.' })
      return
    }

    if (useNewCard) {
      if (!cardElement) {
        setMessage({ tone: 'error', text: 'Enter card details to continue.' })
        return
      }

      const setupIntent = await createStripeSetupIntent()
      if (!setupIntent.ok) {
        setMessage({ tone: 'error', text: setupIntent.message })
        return
      }

      const confirmResult = await stripe!.confirmCardSetup(setupIntent.clientSecret, {
        payment_method: { card: cardElement },
      })

      if (confirmResult.error) {
        setMessage({ tone: 'error', text: confirmResult.error.message ?? 'Unable to save this card.' })
        return
      }

      cardElement.clear()
    }

    const actionResult = requiresAcceptance ? await acceptPaymentPlan({ planId }) : await retryPaymentPlan({ planId })

    if (!actionResult.ok) {
      setMessage({ tone: 'error', text: actionResult.message })
      return
    }

    if ('attempted' in actionResult && actionResult.attempted === 0) {
      setMessage({ tone: 'success', text: 'No overdue payments were found to retry.' })
    } else {
      setMessage({
        tone: 'success',
        text: requiresAcceptance ? 'Subscription accepted.' : 'We are retrying your payments now.',
      })
    }

    router.refresh()
  }

  const savedCardExpired = clientCard ? cardIsExpired(clientCard) : false
  const showSavedCardButton = Boolean(clientCard && !savedCardExpired)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{requiresAcceptance ? 'Accept your subscription' : 'Resolve payments'}</CardTitle>
        <CardDescription>
          {requiresAcceptance
            ? 'Accept the terms below to start automatic billing.'
            : 'Retry outstanding payments using your saved or new card.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? <Alert tone={message.tone} title={message.text} /> : null}
        {hasOverdue && amountOverdueLabel ? (
          <Alert tone="warning" title="Overdue payments" description={`${amountOverdueLabel} will be charged.`} />
        ) : null}
        {requiresAcceptance ? (
          <Alert
            tone="warning"
            title="Subscription requires acceptance"
            description="By accepting, you allow this service provider to charge your card based on this subscription's terms."
          />
        ) : null}

        {clientCard ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Saved card details</p>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <CardDetails card={clientCard} />
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {showSavedCardButton ? (
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={isPending}
              onClick={() => startTransition(() => handleAction(false))}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CreditCard className="size-4" aria-hidden />
              )}
              {actionLabel} with saved card
            </Button>
          ) : null}

          {showSavedCardButton ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              Or use a new card
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="plan-card-details" className="text-sm font-medium text-foreground">
              New card details
            </label>
            <StripeCardElement id="plan-card-details" onReady={setCardElement} />
          </div>

          <Button
            type="button"
            variant={clientCard ? 'secondary' : 'default'}
            size="lg"
            className="w-full"
            disabled={isPending || !stripe || !cardElement}
            onClick={() => startTransition(() => handleAction(true))}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CreditCard className="size-4" aria-hidden />
            )}
            {actionLabel} with new card
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
