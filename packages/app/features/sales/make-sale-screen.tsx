'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View, StyleProp, StyleSheet } from 'react-native'
import { useRouter } from 'app/navigation'

import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { TextField } from 'app/components/text-field'
import { useAuth } from 'app/provider/auth'
import { useTheme } from 'app/theme'
import {
  createPaymentRequest,
  createSale,
  createSalePayment,
  createSaleProduct,
  fetchClients,
  fetchProducts,
  formatPrice,
  type Client,
  type CreateSalePaymentPayload,
  type Product,
} from 'app/services/sales'

type PaymentMode = 'record' | 'request' | 'card'
type ManualMethod = 'cash' | 'electronic'
type SpecificMethod =
  | 'Bank Transfer'
  | 'PayPal'
  | 'Square'
  | 'Stripe'
  | 'Cash App'
  | 'WeChat'
  | 'Venmo'
type DueAfter = 'uponReceipt' | 'oneWeek' | 'twoWeeks'

const paymentModes: { id: PaymentMode; label: string; helper: string }[] = [
  {
    id: 'record',
    label: 'Record',
    helper: 'Log a payment you collected offline.',
  },
  {
    id: 'request',
    label: 'Request',
    helper: 'Email the client a payment link.',
  },
  {
    id: 'card',
    label: 'Charge',
    helper: 'Card charges are coming soon on web.',
  },
]

const manualMethods: { id: ManualMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'electronic', label: 'EFT' },
]

const eftSpecificMethods: SpecificMethod[] = [
  'Bank Transfer',
  'PayPal',
  'Square',
  'Stripe',
  'Cash App',
  'WeChat',
  'Venmo',
]

const dueAfterOptions: { id: DueAfter; label: string; iso: string | null }[] = [
  { id: 'uponReceipt', label: 'Upon receipt', iso: null },
  { id: 'oneWeek', label: 'In 7 days', iso: 'P1W' },
  { id: 'twoWeeks', label: 'In 14 days', iso: 'P2W' },
]

export function MakeSaleScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()
  const { session, ready } = useAuth()

  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [useCustomItem, setUseCustomItem] = useState(false)
  const [customName, setCustomName] = useState('One-off session')
  const [customAmount, setCustomAmount] = useState('')
  const [customCurrency, setCustomCurrency] = useState('USD')

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('record')
  const [manualMethod, setManualMethod] = useState<ManualMethod>('cash')
  const [specificMethod, setSpecificMethod] = useState<SpecificMethod | null>(null)
  const [dueAfter, setDueAfter] = useState<DueAfter>('uponReceipt')
  const [passOnFee, setPassOnFee] = useState(false)
  const [note, setNote] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const {
    data: clients = [],
    isPending: clientsPending,
    isFetching: clientsFetching,
    error: clientsError,
  } = useQuery({
    queryKey: ['clients', session?.trainerId],
    enabled: ready && Boolean(session),
    queryFn: () => (session ? fetchClients(session) : Promise.resolve([])),
    staleTime: 60_000,
  })

  const {
    data: products = [],
    isPending: productsPending,
    isFetching: productsFetching,
    error: productsError,
  } = useQuery({
    queryKey: ['products', session?.trainerId],
    enabled: ready && Boolean(session),
    queryFn: () => (session ? fetchProducts(session) : Promise.resolve([])),
    staleTime: 60_000,
  })

  const filteredClients = useMemo(() => {
    if (!clients || clientSearch.trim().length === 0) return clients ?? []
    const query = clientSearch.toLowerCase()
    return clients.filter((client) => {
      const name = `${client.firstName ?? ''} ${client.lastName ?? ''}`.toLowerCase()
      const email = client.email?.toLowerCase() ?? ''
      return name.includes(query) || email.includes(query)
    })
  }, [clients, clientSearch])

  const sortedProducts = useMemo(
    () => (products ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  )

  const amountNumber = useMemo(() => {
    if (useCustomItem) {
      const parsed = Number.parseFloat(customAmount.replace(/,/g, ''))
      return Number.isFinite(parsed) ? parsed : 0
    }
    return selectedProduct?.price ?? 0
  }, [customAmount, selectedProduct?.price, useCustomItem])

  const resolvedCurrency = selectedProduct?.currency ?? customCurrency

  const submitLabel = useMemo(() => {
    switch (paymentMode) {
    case 'record':
      return 'Record payment'
    case 'request':
      return 'Send request'
    case 'card':
      return 'Charge card (coming soon)'
    default:
      return 'Continue'
    }
  }, [paymentMode])

  const buttonDisabled =
    !session ||
    !selectedClient ||
    amountNumber <= 0 ||
    paymentMode === 'card' ||
    (paymentMode === 'record' && manualMethod === 'electronic' && !specificMethod)

  const statusMessage = error ?? success
  const statusTone: 'error' | 'success' | null = error ? 'error' : success ? 'success' : null

  const handleSubmit = async () => {
    if (!session) {
      setError('Sign in to make a sale.')
      return
    }

    if (!selectedClient) {
      setError('Choose a client first.')
      return
    }

    if (paymentMode === 'request' && !selectedClient.email) {
      setError('This client needs an email address to receive a payment request.')
      return
    }

    if (amountNumber <= 0) {
      setError('Enter a valid amount greater than 0.')
      return
    }

    if (paymentMode === 'record' && manualMethod === 'electronic' && !specificMethod) {
      setError('Select the EFT type to record this payment.')
      return
    }

    if (paymentMode === 'card') {
      setError('Card charges are handled in the native app for now. Use Request to send a pay link.')
      return
    }

    const name = useCustomItem
      ? customName.trim() || 'Custom item'
      : selectedProduct?.name ?? 'Item'

    const payloadCurrency = resolvedCurrency || 'USD'
    const amountString = formatPrice(amountNumber)

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const saleId = await createSale(
        {
          clientId: selectedClient.id,
          note: note.trim() || null,
          dueAfter: paymentMode === 'request' ? mapDueAfter(dueAfter) : null,
          paymentRequestPassOnTransactionFee: paymentMode === 'request' ? passOnFee : undefined,
        },
        session
      )

      await createSaleProduct(
        {
          saleId,
          productId: useCustomItem ? undefined : selectedProduct?.id,
          price: amountString,
          currency: payloadCurrency,
          name,
          type: selectedProduct?.type ?? 'service',
        },
        session
      )

      if (paymentMode === 'request') {
        await createPaymentRequest(saleId, session)
        setSuccess('Payment request sent to the client.')
      } else {
        const salePaymentPayload: CreateSalePaymentPayload = {
          saleId,
          amount: amountString,
          currency: payloadCurrency,
          type: 'manual',
          method: manualMethod,
          specificMethodName: manualMethod === 'electronic' ? specificMethod ?? undefined : undefined,
        }

        const result = await createSalePayment(salePaymentPayload, session)
        if (result.status === 'paid') {
          setSuccess('Payment recorded successfully.')
        } else {
          setSuccess('Payment saved.')
        }
      }

      setTimeout(() => router.back(), 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete sale')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text style={styles.title}>Make sale</Text>
          <Text style={styles.subtitle}>
            Select a client, add an item, and either record a payment or send a request. This mirrors the
            native flow so you can keep billing moving on web.
          </Text>
        </View>
        <Button label="Close" onPress={() => router.back()} style={styles.closeButton} />
      </View>

      {!ready ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Loading account…</Text>
        </Card>
      ) : !session ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Sign in to continue</Text>
          <Text style={styles.helper}>You need to be logged in to create a sale.</Text>
          <Button label="Go to login" onPress={() => router.push('/auth')} />
        </Card>
      ) : null}

      {statusTone ? (
        <Card style={[styles.card, statusTone === 'error' ? styles.errorCard : styles.successCard]}>
          <Text style={statusTone === 'error' ? styles.errorText : styles.successText}>{statusMessage}</Text>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <SectionHeader step="01" title="Choose client" />
        <TextField
          label="Search"
          value={clientSearch}
          onChangeText={setClientSearch}
          placeholder="Name or email"
          autoCapitalize="none"
        />
        {clientsError ? (
          <Text style={styles.errorText}>Unable to load clients.</Text>
        ) : clientsPending || clientsFetching ? (
          <ActivityIndicator />
        ) : filteredClients && filteredClients.length > 0 ? (
          <View style={styles.chipGrid}>
            {filteredClients.slice(0, 12).map((client) => {
              const fullName = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() || 'Client'
              const isSelected = selectedClient?.id === client.id
              return (
                <ChoicePill
                  key={client.id}
                  label={fullName}
                  caption={client.email ?? undefined}
                  selected={isSelected}
                  onPress={() => setSelectedClient(client)}
                />
              )
            })}
          </View>
        ) : (
          <Text style={styles.helper}>No clients found. Add one in the native app to continue.</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <SectionHeader step="02" title="Pick an item" />
        {productsError ? (
          <Text style={styles.errorText}>Unable to load products.</Text>
        ) : productsPending || productsFetching ? (
          <ActivityIndicator />
        ) : sortedProducts.length > 0 ? (
          <View style={styles.chipGrid}>
            {sortedProducts.slice(0, 10).map((product) => (
              <ChoicePill
                key={product.id}
                label={product.name}
                caption={`${product.currency} ${formatPrice(product.price)}`}
                selected={!useCustomItem && selectedProduct?.id === product.id}
                onPress={() => {
                  setSelectedProduct(product)
                  setUseCustomItem(false)
                  setCustomCurrency(product.currency)
                }}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.helper}>No products yet. Use a custom amount instead.</Text>
        )}

        <View style={styles.divider} />
        <Text style={styles.helper}>Or enter a custom amount</Text>
        <View style={styles.inlineFields}>
          <TextField
            label="Name"
            value={customName}
            onChangeText={(text) => {
              setCustomName(text)
              setUseCustomItem(true)
            }}
            style={{ flex: 1 }}
          />
          <TextField
            label="Amount"
            keyboardType="decimal-pad"
            value={customAmount}
            onChangeText={(text) => {
              setCustomAmount(text)
              setUseCustomItem(true)
            }}
            style={styles.amountField}
          />
          <TextField
            label="Currency"
            value={customCurrency}
            autoCapitalize="characters"
            onChangeText={(text) => {
              setCustomCurrency(text.toUpperCase())
              setUseCustomItem(true)
            }}
            style={styles.currencyField}
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionHeader step="03" title="Payment" />

        <View style={styles.segmentRow}>
          {paymentModes.map((mode) => (
            <ChoicePill
              key={mode.id}
              label={mode.label}
              caption={mode.helper}
              selected={paymentMode === mode.id}
              onPress={() => setPaymentMode(mode.id)}
            />
          ))}
        </View>

        {paymentMode === 'record' ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Method</Text>
            <View style={styles.rowGap}>
              {manualMethods.map((method) => (
                <ChoicePill
                  key={method.id}
                  label={method.label}
                  selected={manualMethod === method.id}
                  onPress={() => {
                    setManualMethod(method.id)
                    setSpecificMethod(null)
                  }}
                  compact
                />
              ))}
            </View>
            {manualMethod === 'electronic' ? (
              <View style={styles.rowGap}>
                <Text style={styles.helper}>Choose the EFT type</Text>
                <View style={styles.chipGrid}>
                  {eftSpecificMethods.map((method) => (
                    <ChoicePill
                      key={method}
                      label={method}
                      selected={specificMethod === method}
                      onPress={() => setSpecificMethod(method)}
                      compact
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {paymentMode === 'request' ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>When is it due?</Text>
            <View style={styles.chipGrid}>
              {dueAfterOptions.map((option) => (
                <ChoicePill
                  key={option.id}
                  label={option.label}
                  selected={dueAfter === option.id}
                  onPress={() => setDueAfter(option.id)}
                  compact
                />
              ))}
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Pass fees to client</Text>
                <Text style={styles.helper}>Add the processing fee on top of the amount.</Text>
              </View>
              <Switch value={passOnFee} onValueChange={setPassOnFee} />
            </View>
          </View>
        ) : null}

        {paymentMode === 'card' ? (
          <View style={styles.infoBox}>
            <Text style={styles.helper}>
              Card charges aren’t wired in this build yet. Use Request to send a payment link or Record to log an
              in-person payment.
            </Text>
          </View>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <SectionHeader step="04" title="Notes" />
        <TextField
          label="Add a note"
          value={note}
          onChangeText={setNote}
          placeholder="Optional memo for this sale"
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />
      </Card>

      <Card style={[styles.card, styles.summaryCard]}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <SummaryRow label="Client" value={selectedClient ? buildClientName(selectedClient) : 'Not selected'} />
        <SummaryRow
          label="Item"
          value={useCustomItem || !selectedProduct ? customName : selectedProduct?.name ?? 'Item'}
        />
        <SummaryRow label="Payment" value={paymentLabel(paymentMode, manualMethod)} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {resolvedCurrency} {formatPrice(amountNumber)}
          </Text>
        </View>
        <View style={styles.ctaRow}>
          <Button label={submitLabel} onPress={handleSubmit} disabled={buttonDisabled} loading={submitting} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) =>
              ([styles.outlineButton, pressed && styles.pillPressed] as StyleProp)
            }
          >
            <Text style={styles.outlineLabel}>Cancel</Text>
          </Pressable>
        </View>
      </Card>
    </ScrollView>
  )
}

function buildClientName(client: Client) {
  const fullName = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  return fullName.length > 0 ? fullName : 'Client'
}

function mapDueAfter(option: DueAfter) {
  return dueAfterOptions.find((o) => o.id === option)?.iso ?? null
}

function paymentLabel(mode: PaymentMode, manualMethod: ManualMethod) {
  switch (mode) {
  case 'record':
    return manualMethod === 'electronic' ? 'Recorded (EFT)' : 'Recorded (cash)'
  case 'request':
    return 'Payment request'
  case 'card':
    return 'Charge card (coming soon)'
  default:
    return 'Payment'
  }
}

function SectionHeader({ step, title }: { step: string; title: string }) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.stepPill}>
        <Text style={styles.stepText}>{step}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  )
}

function ChoicePill({
  label,
  caption,
  selected,
  onPress,
  compact,
}: {
  label: string
  caption?: string
  selected?: boolean
  onPress?: () => void
  compact?: boolean
}) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) =>
        ([
          styles.pill,
          selected && styles.pillSelected,
          compact && styles.pillCompact,
          pressed && styles.pillPressed,
        ] as StyleProp)
      }
    >
      <Text style={[styles.pillLabel, selected ? styles.pillLabelSelected : null]}>{label}</Text>
      {caption ? (
        <Text style={[styles.pillCaption, selected ? styles.pillCaptionSelected : null]}>{caption}</Text>
      ) : null}
    </Pressable>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    container: {
      padding: theme.spacing.lg,
      gap: theme.spacing.lg,
      backgroundColor: theme.colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    title: {
      fontSize: theme.typography.h1 + 2,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
      lineHeight: 20,
    },
    closeButton: {
      alignSelf: 'flex-start',
    },
    card: {
      gap: theme.spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    stepPill: {
      backgroundColor: theme.colors.text,
      borderRadius: theme.radii.lg,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
    },
    stepText: {
      color: theme.colors.background,
      fontWeight: '700',
      fontSize: 12,
    },
    sectionTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    helper: {
      color: theme.colors.secondaryText,
    },
    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    pill: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      backgroundColor: theme.colors.surface,
      minWidth: 120,
    },
    pillPressed: {
      opacity: 0.9,
    },
    pillCompact: {
      minWidth: undefined,
    },
    pillSelected: {
      borderColor: theme.colors.text,
      backgroundColor: theme.colors.text,
    },
    pillLabel: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    pillLabelSelected: {
      color: theme.colors.background,
    },
    pillCaption: {
      color: theme.colors.secondaryText,
      fontSize: 12,
    },
    pillCaptionSelected: {
      color: theme.colors.background,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border,
    },
    inlineFields: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      alignItems: 'flex-end',
    },
    amountField: {
      width: 120,
    },
    currencyField: {
      width: 90,
    },
    segmentRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    sectionBlock: {
      gap: theme.spacing.sm,
    },
    rowGap: {
      gap: theme.spacing.sm,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    infoBox: {
      backgroundColor: theme.colors.border,
      padding: theme.spacing.sm,
      borderRadius: theme.radii.md,
    },
    multiline: {
      minHeight: 90,
      textAlignVertical: 'top',
    },
    summaryCard: {
      gap: theme.spacing.sm,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    summaryLabel: {
      color: theme.colors.secondaryText,
    },
    summaryValue: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: theme.spacing.xs,
    },
    totalLabel: {
      fontWeight: '800',
      color: theme.colors.text,
    },
    totalValue: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 18,
    },
    ctaRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    outlineButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      paddingVertical: theme.spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    outlineLabel: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    errorText: {
      color: '#dc2626',
      fontWeight: '600',
    },
    successText: {
      color: '#15803d',
      fontWeight: '600',
    },
    errorCard: {
      borderColor: '#fee2e2',
      backgroundColor: '#fef2f2',
    },
    successCard: {
      borderColor: '#dcfce7',
      backgroundColor: '#f0fdf4',
    },
  })
