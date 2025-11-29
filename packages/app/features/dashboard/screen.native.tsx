'use client'

import React, { useMemo } from 'react'
import {
  Screen,
  SectionList,
  Section,
  VStack,
  HStack,
  TitleText,
  TextBody,
  CaptionText,
  PrimaryButton,
  SecondaryButton,
  Card,
  LoadingSpinner,
} from 'app/ui/native'
import { useRouter } from 'app/navigation'
import { useAuth } from 'app/provider/auth'
import { useDashboardData, type DashboardSummary } from './use-dashboard-data'

function CurrencyValue({ amount, currency }: { amount: number; currency: string }) {
  return <TitleText size={18}>{formatCurrency(amount, currency)}</TitleText>
}

export function DashboardScreen() {
  const router = useRouter()
  const { token } = useAuth()
  const { data, isPending, error, refetch } = useDashboardData()

  const now = useMemo(() => new Date(), [])
  const dateText = useMemo(
    () =>
      now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [now]
  )

  const greeting = useMemo(() => {
    const hour = now.getHours()
    const name = data?.trainer.firstName?.trim() || 'trainer'
    if (hour < 12) return `Morning, ${name}`
    if (hour < 17) return `Afternoon, ${name}`
    return `Evening, ${name}`
  }, [now, data?.trainer.firstName])

  if (isPending && !data) {
    return (
      <Screen title="Dashboard" subtitle="Loading your business pulse">
        <Card>
          <LoadingSpinner />
          <CaptionText>Fetching dashboard data…</CaptionText>
        </Card>
      </Screen>
    )
  }

  if (error && !data) {
    return (
      <Screen title="Dashboard" subtitle="Something went wrong">
        <Card>
          <CaptionText color="#f87171">{error.message}</CaptionText>
          <PrimaryButton onPress={() => void refetch()}>Retry</PrimaryButton>
        </Card>
      </Screen>
    )
  }

  const payments = data?.payments
  const bookings = data?.onlineBookings

  return (
    <Screen title="Dashboard" subtitle={greeting}>
      <SectionList>
        <Section title={dateText}>
          <VStack spacing={10}>
            <HStack spacing={12}>
              <Card>
                <TitleText size={18}>Status</TitleText>
                <CaptionText>{token ? 'Signed in' : 'Awaiting sign-in'}</CaptionText>
              </Card>
              <Card>
                <TitleText size={18}>Trial</TitleText>
                <CaptionText>
                  {data?.trainer.trialDaysRemaining != null
                    ? `${data.trainer.trialDaysRemaining} days left`
                    : '—'}
                </CaptionText>
              </Card>
            </HStack>
            <Card>
              <TitleText size={18}>Text credits</TitleText>
              <CaptionText>
                {typeof data?.trainer.smsCredits === 'number'
                  ? `${data.trainer.smsCredits} available`
                  : 'Unknown'}
              </CaptionText>
            </Card>
          </VStack>
        </Section>

        <Section title="Payments">
          {payments ? (
            <VStack spacing={12}>
              <HStack spacing={12}>
                <MetricCard title="Last 7 days (projected)" value={payments.last7Days.projected} currency={payments.currency} />
                <MetricCard title="Last 7 days (paid)" value={payments.last7Days.paid} currency={payments.currency} />
              </HStack>
              <HStack spacing={12}>
                <MetricCard title="Today projected" value={payments.today.projected} currency={payments.currency} />
                <MetricCard title="Today paid" value={payments.today.paid} currency={payments.currency} />
              </HStack>
            </VStack>
          ) : (
            <CaptionText>No payment data yet.</CaptionText>
          )}
        </Section>

        <Section title="Bookings">
          {bookings ? (
            <VStack spacing={10}>
              <TextBody>{bookings.bookableCount} bookable sessions online</TextBody>
            </VStack>
          ) : (
            <CaptionText>Bookings will appear here when configured.</CaptionText>
          )}
        </Section>

        <Section title="Quick actions">
          <VStack spacing={10}>
            <PrimaryButton onPress={() => router.push('/make-sale')}>Make sale</PrimaryButton>
            <SecondaryButton onPress={() => router.push('/clients/add')}>Add client</SecondaryButton>
          </VStack>
        </Section>
      </SectionList>
    </Screen>
  )
}

function MetricCard({ title, value, currency }: { title: string; value: number; currency: DashboardSummary['payments']['currency'] }) {
  return (
    <Card>
      <CaptionText>{title}</CaptionText>
      <CurrencyValue amount={value} currency={currency} />
    </Card>
  )
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}
