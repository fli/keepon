import Link from 'next/link'

import { AlertCircle, Bell, Calendar, ChevronRight, Clock, PenSquare } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardActions } from './dashboard-actions'

export function DashboardHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-40" />
        </div>
        <DashboardActions />
      </div>

      <Button
        variant="outline"
        size="icon-lg"
        aria-label="Notifications"
        nativeButton={false}
        render={<Link href="/dashboard/notifications" />}
      >
        <Bell className="size-5" aria-hidden />
      </Button>
    </div>
  )
}

export function PaymentsSkeleton() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Payments</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="gap-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">Payments</p>
              <div className="w-36">
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Projected</p>
                <Skeleton className="h-7 w-28" />
              </div>
              <div className="mx-3 h-10 w-px bg-border" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Paid</p>
                <Skeleton className="h-7 w-24" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="rounded-full p-2">
                  <AlertCircle className="size-4" aria-hidden />
                </Badge>
                <CardDescription className="text-sm font-semibold text-foreground">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-8" />
                    <span>overdue payments</span>
                  </div>
                </CardDescription>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </div>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <CardTitle className="text-3xl text-foreground">
              <Skeleton className="h-8 w-28" />
            </CardTitle>
          </CardContent>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">
              Funds to transfer to your account
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto pt-0 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Pending</p>
                <Skeleton className="h-7 w-24" />
              </div>
              <div className="mx-3 h-10 w-px bg-border" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Available</p>
                <Skeleton className="h-7 w-24" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col gap-3 border-dashed">
          <CardHeader className="space-y-2 pb-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-60" />
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <Skeleton className="h-9 w-28" />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function SubscriptionsSkeleton() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Subscriptions & Packs</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between pb-1">
            <div>
              <CardDescription className="text-sm font-semibold text-foreground">Active subscriptions</CardDescription>
              <Skeleton className="h-9 w-14" />
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between pb-1">
            <div>
              <CardDescription className="text-sm font-semibold text-foreground">Active packs</CardDescription>
              <Skeleton className="h-9 w-14" />
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </div>
    </section>
  )
}

export function NextAppointmentSkeleton() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Next Appointment</h2>
      <div className="grid">
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">Next appointment</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="size-4" aria-hidden />
              <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function OnlineBookingsSkeleton() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Online Bookings</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col border-dashed">
          <CardHeader className="space-y-2 pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">Setup online bookings</CardDescription>
            <p className="text-sm text-muted-foreground">Share your services and start taking bookings in minutes.</p>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <Skeleton className="h-9 w-44" />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="space-y-1 pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">Example booking page</CardDescription>
            <p className="text-sm text-muted-foreground">Preview what your clients will see when they book.</p>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <Button variant="secondary" className="w-fit" disabled>
              <Skeleton aria-hidden className="h-4 w-28" />
              <span className="sr-only">View example</span>
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div>
                <CardDescription className="text-sm font-semibold text-foreground">
                  Today&apos;s online booking availability
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit online booking availability" disabled>
                <PenSquare className="size-4" aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="mt-auto space-y-2 pt-3">
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">
              <Clock className="size-4" aria-hidden />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
