'use client'

import { useCallback, useMemo, useState, useTransition, type FormEvent } from 'react'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { Client } from '@/lib/api'
import { CheckCircle2, Clock, Send, Wallet } from 'lucide-react'
import { CreditPack, completeCreditPackSale } from './actions'

type PaymentKind = 'record' | 'request'
type RecordMethod = 'cash' | 'eft'

type Props = {
  client: Client
  pack: CreditPack
}

const EFT_OPTIONS = [
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'interac', label: 'Interac e-Transfer' },
  { id: 'other_eft', label: 'Other EFT' },
]

const formatPrice = (amount: string, currency: string) => {
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed)) return `${amount} ${currency}`

  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(parsed)
  } catch {
    return `${parsed.toFixed(2)} ${currency}`
  }
}

export function PaymentForm({ client, pack }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const paymentParam = searchParams.get('payment')
  const methodParam = searchParams.get('method')
  const eftParam = searchParams.get('eftType')
  const passFeeParam = searchParams.get('passFee')
  const dueParam = searchParams.get('due')
  const noteParam = searchParams.get('note') ?? ''
  const nameParam = searchParams.get('packName') ?? pack.name
  const priceParam = searchParams.get('packPrice') ?? pack.price
  const creditsParam = searchParams.get('packCredits') ?? String(pack.totalCredits)

  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<null | { status: 'paid' | 'requested'; saleId: string }>(null)
  const [error, setError] = useState<string | null>(null)

  const paymentKind: PaymentKind = paymentParam === 'request' ? 'request' : 'record'
  const recordMethod: RecordMethod = methodParam === 'eft' ? 'eft' : 'cash'
  const eftType = eftParam ?? EFT_OPTIONS[0]?.id ?? 'bank_transfer'
  const passFee = passFeeParam === 'true'
  const dueDate = dueParam ?? ''
  const note = noteParam
  const packName = nameParam.trim() || pack.name
  const packPrice = priceParam.trim() || pack.price
  const packCredits = creditsParam.trim()
  const creditsValue = Number.parseInt(packCredits, 10)

  const setParam = useCallback(
    (key: string, value?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null || value === undefined || value.trim() === '') params.delete(key)
      else params.set(key, value)

      const qs = params.toString()
      const href = (qs ? `${pathname}?${qs}` : pathname) as Route
      router.replace(href, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)
      setResult(null)

      startTransition(async () => {
        try {
          const outcome = await completeCreditPackSale({
            clientId: client.id,
            productId: pack.id,
            paymentKind,
            recordMethod,
            eftType: recordMethod === 'eft' ? eftType : undefined,
            passOnFee: passFee,
            dueDate: paymentKind === 'request' ? dueDate : undefined,
            note: note.trim() || undefined,
            packName: packName || undefined,
            packPrice: packPrice || undefined,
            packCredits: Number.isFinite(creditsValue) ? creditsValue : undefined,
          })
          setResult(outcome)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unable to complete the sale.'
          setError(message)
        }
      })
    },
    [
      client.id,
      pack.id,
      paymentKind,
      recordMethod,
      eftType,
      passFee,
      dueDate,
      note,
      packName,
      packPrice,
      creditsValue,
      startTransition,
    ]
  )

  const paymentLabel = paymentKind === 'request' ? 'Send request' : 'Record payment'

  const statusBadge = useMemo(() => {
    if (!result) return null
    const isPaid = result.status === 'paid'
    const Icon = isPaid ? CheckCircle2 : Clock
    const bg = isPaid ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'
    const text = isPaid ? 'Payment recorded' : 'Payment request sent'
    return (
      <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${bg}`}>
        <Icon className="size-4" aria-hidden />
        <span>{text}</span>
      </div>
    )
  }, [result])

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Collect payment</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;re selling <strong>{packName}</strong> to{' '}
            <strong>{`${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() || 'this client'}</strong> for{' '}
            {formatPrice(packPrice, pack.currency)}.
          </p>
        </div>

        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tracking-wide uppercase">
              Step 1: Select client
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tracking-wide uppercase">
              Step 2: Choose credit pack
            </span>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
              Step 3: Payment type
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md bg-muted px-3 py-1 text-xs">
              Credits: {Number.isFinite(creditsValue) ? creditsValue : pack.totalCredits}
            </span>
            <span className="rounded-md bg-muted px-3 py-1 text-xs">
              Price: {formatPrice(packPrice, pack.currency)}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="packName">Pack name</Label>
              <Input
                id="packName"
                value={packName}
                onChange={(event) => setParam('packName', event.target.value)}
                placeholder={pack.name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="packPrice">Price</Label>
              <Input
                id="packPrice"
                inputMode="decimal"
                value={packPrice}
                onChange={(event) => setParam('packPrice', event.target.value)}
                placeholder={pack.price}
              />
              <p className="text-xs text-muted-foreground">
                Stored in the URL as <code>packPrice</code> so refreshes keep your edits.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="packCredits">Credits</Label>
              <Input
                id="packCredits"
                inputMode="numeric"
                value={packCredits}
                onChange={(event) => setParam('packCredits', event.target.value)}
                placeholder={String(pack.totalCredits)}
              />
            </div>
          </div>
        </div>
      </section>

      {statusBadge}
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold">Payment type</h3>
            <p className="text-sm text-muted-foreground">Pick how you want to collect this payment.</p>
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setParam('payment', 'record')}
                className={`flex items-center gap-2 rounded-md border px-3 py-3 text-left transition ${
                  paymentKind === 'record' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
              >
                <Wallet className="size-4" aria-hidden />
                <div>
                  <p className="font-medium">Record</p>
                  <p className="text-xs text-muted-foreground">Cash or EFT already received</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setParam('payment', 'request')}
                className={`flex items-center gap-2 rounded-md border px-3 py-3 text-left transition ${
                  paymentKind === 'request' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
              >
                <Send className="size-4" aria-hidden />
                <div>
                  <p className="font-medium">Request</p>
                  <p className="text-xs text-muted-foreground">Send a payment request</p>
                </div>
              </button>
            </div>

            {paymentKind === 'record' ? (
              <div className="space-y-4 rounded-md border border-border/80 bg-muted/30 p-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={recordMethod === 'cash' ? 'default' : 'outline'}
                    onClick={() => setParam('method', 'cash')}
                  >
                    Cash
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={recordMethod === 'eft' ? 'default' : 'outline'}
                    onClick={() => setParam('method', 'eft')}
                  >
                    EFT
                  </Button>
                </div>

                {recordMethod === 'eft' ? (
                  <div className="space-y-2">
                    <Label htmlFor="eftType">EFT type</Label>
                    <NativeSelect
                      id="eftType"
                      value={eftType}
                      onChange={(event) => setParam('eftType', event.target.value)}
                    >
                      {EFT_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
              </div>
            ) : null}

            {paymentKind === 'request' ? (
              <div className="space-y-4 rounded-md border border-border/80 bg-muted/30 p-4">
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Payment due date</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setParam('due', event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We store the due date in the URL as <code>due</code> so you can refresh without losing it.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={passFee}
                    onChange={(event) => setParam('passFee', event.target.checked ? 'true' : 'false')}
                  />
                  Pass transaction fee to client
                </label>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="note">Note / memo</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(event) => setParam('note', event.target.value)}
                placeholder="Optional note that will be saved with the sale"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Notes are kept in the URL while you work so you don&apos;t lose them on refresh.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {paymentKind === 'request'
              ? 'We will create the sale and send a payment request.'
              : 'We will create the sale and mark it as paid.'}
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending} className="min-w-[140px]">
              {pending ? 'Working...' : paymentLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
