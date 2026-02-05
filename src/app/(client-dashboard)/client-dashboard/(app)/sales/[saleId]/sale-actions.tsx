'use client'

import type {
  PaymentRequest,
  PaymentRequestPaymentMethodEvent,
  StripeCardElement as StripeCardElementType,
} from '@stripe/stripe-js'
import { PaymentRequestButtonElement, useStripe } from '@stripe/react-stripe-js'
import { CreditCard, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { createSalePayment } from '@/app/(client-dashboard)/client-dashboard/actions'
import { Alert } from '@/components/client-dashboard/Alert'
import { CardDetails } from '@/components/client-dashboard/CardDetails'
import { StripeCardElement } from '@/components/client-dashboard/StripeCardElement'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cardIsExpired, getErrorMessage } from '@/lib/client-dashboard/format'

type SaleActionsProps = {
  saleId: string
  amount: string
  currency: string
  amountInSmallestUnit: number
  baseTotalLabel: string
  paymentRequestPassOnTransactionFee: boolean
  serviceProviderName: string
  serviceProviderCountry: string
  serviceProviderCurrency: string
  savedCard: {
    paymentMethodId: string
    last4: string
    expYear: number
    expMonth: number
    brand: string
    country: string | null
  } | null
  savedCardTotalLabel?: string | null
}

export function SaleActions({
  saleId,
  amount,
  currency,
  amountInSmallestUnit,
  baseTotalLabel,
  paymentRequestPassOnTransactionFee,
  serviceProviderName,
  serviceProviderCountry,
  serviceProviderCurrency,
  savedCard,
  savedCardTotalLabel,
}: SaleActionsProps) {
  const stripe = useStripe()
  const router = useRouter()
  const [cardElement, setCardElement] = useState<StripeCardElementType | null>(null)
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null)
  const [saveAsDefault, setSaveAsDefault] = useState(true)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [activeMethod, setActiveMethod] = useState<'saved' | 'new' | 'paymentRequest' | null>(null)
  const [isPending, startTransition] = useTransition()

  const savedCardExpired = savedCard ? cardIsExpired(savedCard) : false
  const showSavedCard = Boolean(savedCard && !savedCardExpired)

  useEffect(() => {
    if (!stripe) {
      return
    }

    const pr = stripe.paymentRequest({
      country: serviceProviderCountry.toUpperCase(),
      currency: serviceProviderCurrency.toLowerCase(),
      total: {
        amount: amountInSmallestUnit,
        label: serviceProviderName,
        pending: paymentRequestPassOnTransactionFee,
      },
      requestPayerName: true,
    })

    void pr
      .canMakePayment()
      .then((result) => {
        if (result) {
          setPaymentRequest(pr)
        }
      })
      .catch(() => {
        setPaymentRequest(null)
      })
  }, [
    amountInSmallestUnit,
    paymentRequestPassOnTransactionFee,
    serviceProviderCountry,
    serviceProviderCurrency,
    serviceProviderName,
    stripe,
  ])

  const totalWithFeeLabel = useMemo(() => {
    if (!paymentRequestPassOnTransactionFee) {
      return baseTotalLabel
    }
    return `${baseTotalLabel} + fee`
  }, [baseTotalLabel, paymentRequestPassOnTransactionFee])

  const runPayment = (method: 'saved' | 'new' | 'paymentRequest', task: () => Promise<void>) => {
    setMessage(null)
    setActiveMethod(method)
    startTransition(() => {
      void task()
        .then(() => {
          setMessage({ tone: 'success', text: 'Payment complete.' })
          router.refresh()
        })
        .catch((error) => {
          if (error instanceof Error && error.message === 'Payment cancelled.') {
            return
          }
          setMessage({ tone: 'error', text: getErrorMessage(error) })
        })
        .finally(() => {
          setActiveMethod(null)
        })
    })
  }

  const makePayment = async ({
    paymentMethodId,
    setupFutureUsage,
  }: {
    paymentMethodId: string
    setupFutureUsage?: boolean
  }) => {
    if (!stripe) {
      throw new Error('Stripe is not ready yet.')
    }

    const response = await createSalePayment({
      saleId,
      amount,
      currency,
      stripePaymentMethodId: paymentMethodId,
      setupFutureUsage,
    })

    if (!response.ok) {
      if ('requiresAction' in response && response.requiresAction) {
        const action = await stripe.handleCardAction(response.clientSecret)
        if (!action.paymentIntent) {
          if (action.error instanceof Error) {
            throw action.error
          }
          throw new Error('Additional authentication failed.')
        }
        const retry = await createSalePayment({
          saleId,
          amount,
          currency,
          stripePaymentIntentId: action.paymentIntent.id,
          setupFutureUsage,
        })
        if (!retry.ok) {
          throw new Error(retry.message)
        }
        return
      }
      throw new Error(response.message)
    }
  }

  const handleSavedCard = () => {
    if (!savedCard) {
      return
    }

    runPayment('saved', async () => {
      await makePayment({ paymentMethodId: savedCard.paymentMethodId })
    })
  }

  const handleNewCard = () => {
    if (!stripe || !cardElement) {
      setMessage({ tone: 'error', text: 'Enter card details to continue.' })
      return
    }

    runPayment('new', async () => {
      const paymentMethodResult = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      })

      if (!paymentMethodResult.paymentMethod) {
        if (paymentMethodResult.error instanceof Error) {
          throw paymentMethodResult.error
        }
        throw new Error('Unable to save this card.')
      }

      await makePayment({
        paymentMethodId: paymentMethodResult.paymentMethod.id,
        setupFutureUsage: saveAsDefault,
      })
    })
  }

  const handlePaymentRequest = () => {
    if (!paymentRequest) {
      return
    }

    runPayment('paymentRequest', async () => {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          paymentRequest.off('paymentmethod', handlePaymentMethod)
          paymentRequest.off('cancel', handleCancel)
        }

        const handleCancel = () => {
          cleanup()
          reject(new Error('Payment cancelled.'))
        }

        const handlePaymentMethod = async (event: PaymentRequestPaymentMethodEvent) => {
          try {
            await makePayment({ paymentMethodId: event.paymentMethod.id })
            event.complete('success')
            cleanup()
            resolve()
          } catch (error) {
            event.complete('fail')
            cleanup()
            reject(error instanceof Error ? error : new Error('Payment failed.'))
          }
        }

        paymentRequest.on('paymentmethod', handlePaymentMethod)
        paymentRequest.on('cancel', handleCancel)
        paymentRequest.show()
      })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Complete payment</CardTitle>
        <CardDescription>Choose a payment method below to complete this request.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? <Alert tone={message.tone} title={message.text} /> : null}

        {savedCard ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Saved card details</p>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <CardDetails card={savedCard} />
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {showSavedCard ? (
            <Button type="button" size="lg" className="w-full" disabled={isPending} onClick={handleSavedCard}>
              {activeMethod === 'saved' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CreditCard className="size-4" aria-hidden />
              )}
              Pay {savedCardTotalLabel ?? totalWithFeeLabel} with saved card
            </Button>
          ) : null}

          {stripe && paymentRequest ? (
            <PaymentRequestButtonElement
              onClick={(event) => {
                event.preventDefault()
                handlePaymentRequest()
              }}
              options={{ paymentRequest }}
            />
          ) : null}

          {showSavedCard || paymentRequest ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              Or use a new card
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="sale-card-details" className="text-sm font-medium text-foreground">
              Card details
            </label>
            <StripeCardElement id="sale-card-details" onReady={setCardElement} />
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-border text-primary"
              checked={saveAsDefault}
              onChange={(event) => setSaveAsDefault(event.target.checked)}
            />
            Save as default payment method
          </label>

          <Button
            type="button"
            size="lg"
            variant={showSavedCard ? 'secondary' : 'default'}
            className="w-full"
            disabled={!stripe || !cardElement || isPending}
            onClick={handleNewCard}
          >
            {activeMethod === 'new' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CreditCard className="size-4" aria-hidden />
            )}
            Pay {totalWithFeeLabel} with new card
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
