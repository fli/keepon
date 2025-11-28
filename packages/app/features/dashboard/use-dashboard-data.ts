"use client"

import { useQuery } from '@tanstack/react-query'
import { getOrpcEndpoint } from '@keepon/orpc'
import { useAuth } from 'app/provider/auth'

export type DashboardSummary = {
  trainer: {
    firstName: string | null
    smsCredits: number | null
    trialEndsAt: string | null
    trialDaysRemaining: number | null
    defaultCurrency: string
  }
  missions: {
    id: string
    displayOrder: number
    rewardId: string | null
    rewardClaimed: boolean
    completed: boolean
    title: string
    description: string
    actionUrl: string | null
  }[]
  payments: {
    currency: string
    last7Days: { projected: number; paid: number }
    today: { projected: number; paid: number }
    overdue: { count: number; total: number }
  }
  funds: {
    currency: string
    pending: number
    available: number
  }
  subscriptions: {
    activePlans: number
    activePacks: number
  }
  nextAppointment: {
    id: string
    title: string
    startTime: string
    durationMinutes: number
    location: string | null
    address: string | null
    timezone: string | null
  } | null
  onlineBookings: {
    bookableCount: number
  }
}

export function useDashboardData() {
  const { token } = useAuth()

  return useQuery({
    queryKey: ['dashboard-summary'],
    enabled: Boolean(token),
    refetchInterval: 60_000, // keep dashboard fresh once per minute
    queryFn: async () => {
      if (!token) {
        throw new Error('Authentication token is missing')
      }

      const res = await fetch(getOrpcEndpoint('/api/dashboard/summary'), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        const message = await res.text()
        throw new Error(
          message || `Failed to load dashboard data (${res.status})`
        )
      }

      const json = (await res.json()) as DashboardSummary
      return json
    },
  })
}
