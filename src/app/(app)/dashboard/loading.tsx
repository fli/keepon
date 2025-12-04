import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/page-container'

export default function DashboardLoading() {
  return (
    <PageContainer className="flex flex-col gap-8 py-8">
      <HeaderSkeleton />
      <PaymentsSkeleton />
      <SubscriptionsSkeleton />
      <NextAppointmentSkeleton />
      <OnlineBookingsSkeleton />
    </PageContainer>
  )
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-60" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-32" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-40" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>
      <Skeleton className="h-11 w-11 rounded-lg" />
    </div>
  )
}

function PaymentsSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-6 w-28" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="flex flex-col gap-3">
            <CardHeader className="space-y-3 pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="mt-auto space-y-3 pt-0">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-10 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function SubscriptionsSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index} className="flex flex-col">
            <CardHeader className="space-y-3 pb-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  )
}

function NextAppointmentSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-6 w-40" />
      <div className="grid">
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="mt-auto space-y-3">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function OnlineBookingsSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="flex flex-col">
            <CardHeader className="space-y-3 pb-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="mt-auto space-y-3 pt-0">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
