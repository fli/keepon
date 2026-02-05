import BigNumber from 'bignumber.js'
import { format } from 'date-fns'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  currencyChargeLimits,
  CurrencyNotSupportedError,
  CountryNotSupportedError,
  getTransactionFee,
} from '@/app/api/_lib/transactionFees'
import { Alert } from '@/components/client-dashboard/Alert'
import { EmptyState } from '@/components/client-dashboard/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { capitalize, formatCurrency, toneClassName, toneForStatus } from '@/lib/client-dashboard/format'
import {
  getClientProfile,
  getSale,
  getServiceProvider,
  listSalePayments,
  listSaleProducts,
} from '@/server/client-dashboard/queries'
import { SaleActions } from './sale-actions'

const fallbackInternationalCard = (chargeCountry: string) => (chargeCountry === 'US' ? 'CA' : 'US')

const computePassOnTotals = (args: { subtotal: BigNumber; chargeCountry: string; currency: string }) => {
  const { subtotal } = args
  const chargeCountry = args.chargeCountry.toUpperCase()
  const currency = args.currency.toUpperCase()
  const limits = currencyChargeLimits[currency as keyof typeof currencyChargeLimits]

  if (!limits) {
    return null
  }

  try {
    const domesticFee = getTransactionFee({
      cardCountry: chargeCountry,
      chargeCountry,
      currency,
    })
    const internationalFee = getTransactionFee({
      cardCountry: fallbackInternationalCard(chargeCountry),
      chargeCountry,
      currency,
    })

    const decimals = limits.smallestUnitDecimals
    const computeTotal = (fee: { percentageFee: BigNumber; fixedFee: BigNumber }) => {
      const denominator = new BigNumber(1).minus(fee.percentageFee)
      if (denominator.isZero()) {
        return null
      }
      return subtotal.plus(fee.fixedFee).div(denominator).decimalPlaces(decimals)
    }

    const domesticTotal = computeTotal(domesticFee)
    const internationalTotal = computeTotal(internationalFee)

    if (!domesticTotal || !internationalTotal) {
      return null
    }

    const feeDomesticLabel = domesticFee.feeType === 'european' ? 'EU' : chargeCountry

    return {
      domesticTotal,
      internationalTotal,
      domesticFee: domesticTotal.minus(subtotal),
      internationalFee: internationalTotal.minus(subtotal),
      feeDomesticLabel,
      decimals,
    }
  } catch (error) {
    if (error instanceof CurrencyNotSupportedError || error instanceof CountryNotSupportedError) {
      return null
    }
    return null
  }
}

export default async function SalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params

  const [sale, products, payments, clientProfile, serviceProvider] = await Promise.all([
    getSale(saleId),
    listSaleProducts(saleId),
    listSalePayments(saleId),
    getClientProfile(),
    getServiceProvider(),
  ])

  if (!sale) {
    notFound()
  }

  const subtotal = products.reduce((total, product) => total.plus(product.price), new BigNumber(0))
  const total = new BigNumber(sale.total)
  const totalPaid = new BigNumber(sale.amountPaid)
  const totalRefunded = new BigNumber(sale.amountRefunded)
  const amountDue = total.minus(totalPaid)

  const paid = total.isZero() || totalPaid.eq(total)
  const refunded = totalRefunded.gt(0)
  const dueAt = new Date(sale.dueAt)
  const paidAt = payments.find((payment) => payment.transactedAt)?.transactedAt

  const paymentStatus = paid ? (refunded ? 'refunded' : 'paid') : 'requested'
  const statusClass = toneClassName(toneForStatus(paymentStatus))

  const passOnTotals = sale.paymentRequestPassOnTransactionFee
    ? computePassOnTotals({ subtotal, chargeCountry: serviceProvider.country, currency: sale.currency })
    : null

  const cardCountry = clientProfile.card?.country?.toUpperCase() ?? null
  const savedCardTotal =
    passOnTotals && cardCountry
      ? (() => {
          try {
            const fee = getTransactionFee({
              cardCountry,
              chargeCountry: serviceProvider.country,
              currency: sale.currency,
            })
            const denominator = new BigNumber(1).minus(fee.percentageFee)
            if (denominator.isZero()) {
              return null
            }
            return subtotal.plus(fee.fixedFee).div(denominator).decimalPlaces(passOnTotals.decimals)
          } catch {
            return null
          }
        })()
      : null

  const currencyDecimals =
    currencyChargeLimits[sale.currency as keyof typeof currencyChargeLimits]?.smallestUnitDecimals ?? 2
  const amountInSmallestUnit = subtotal.shiftedBy(currencyDecimals).integerValue(BigNumber.ROUND_HALF_UP).toNumber()

  const serviceProviderName =
    serviceProvider.businessName?.trim() ||
    `${serviceProvider.firstName.trim()}${serviceProvider.lastName ? ` ${serviceProvider.lastName.trim()}` : ''}`.trim()

  const baseTotalLabel = formatCurrency(total, sale.currency)
  const savedCardTotalLabel = savedCardTotal ? formatCurrency(savedCardTotal, sale.currency) : null

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-foreground">Payment request</h1>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/client-dashboard" />}>
          Back to dashboard
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Payment summary</CardTitle>
          <CardDescription>Review the payment details before completing.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Total</p>
            <p className="text-base font-semibold text-foreground">{baseTotalLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge className={statusClass}>{capitalize(paymentStatus)}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground">Due date</p>
            <p className="text-foreground">{Number.isNaN(dueAt.getTime()) ? 'Soon' : format(dueAt, 'PP')}</p>
          </div>
          {paidAt ? (
            <div>
              <p className="text-muted-foreground">Date paid</p>
              <p className="text-foreground">{format(new Date(paidAt), 'PP')}</p>
            </div>
          ) : null}
          {!paid ? (
            <div>
              <p className="text-muted-foreground">Amount due</p>
              <p className="text-foreground">{formatCurrency(amountDue, sale.currency)}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Products included in this payment request.</CardDescription>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <EmptyState title="No products" description="This payment request has no items." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>{product.name}</TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(product.price, sale.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {sale.paymentRequestPassOnTransactionFee && passOnTotals ? (
        <Card>
          <CardHeader>
            <CardTitle>Card fee</CardTitle>
            <CardDescription>
              Your service provider passes on the card processing fee for this payment request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {passOnTotals.domesticFee.eq(passOnTotals.internationalFee) ? (
              <div className="flex items-center justify-between">
                <span>Card fee</span>
                <span className="text-foreground">{formatCurrency(passOnTotals.domesticFee, sale.currency)}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span>{passOnTotals.feeDomesticLabel} cards</span>
                  <span className="text-foreground">{formatCurrency(passOnTotals.domesticFee, sale.currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Non-{passOnTotals.feeDomesticLabel} cards</span>
                  <span className="text-foreground">
                    {formatCurrency(passOnTotals.internationalFee, sale.currency)}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {paid ? (
        <Alert tone="success" title="This payment request is already paid." />
      ) : (
        <SaleActions
          saleId={sale.id}
          amount={subtotal.toFixed(2)}
          currency={sale.currency}
          amountInSmallestUnit={amountInSmallestUnit}
          baseTotalLabel={baseTotalLabel}
          paymentRequestPassOnTransactionFee={sale.paymentRequestPassOnTransactionFee}
          serviceProviderName={serviceProviderName}
          serviceProviderCountry={serviceProvider.country}
          serviceProviderCurrency={serviceProvider.currency}
          savedCard={
            clientProfile.card
              ? {
                  paymentMethodId: clientProfile.card.paymentMethodId,
                  last4: clientProfile.card.last4,
                  expYear: clientProfile.card.expYear,
                  expMonth: clientProfile.card.expMonth,
                  brand: clientProfile.card.brand,
                  country: clientProfile.card.country,
                }
              : null
          }
          savedCardTotalLabel={savedCardTotalLabel}
        />
      )}
    </div>
  )
}
