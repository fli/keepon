import { PageContainer } from '@/components/page-container'
import {
  DashboardHeaderSkeleton,
  NextAppointmentSkeleton,
  OnlineBookingsSkeleton,
  PaymentsSkeleton,
  SubscriptionsSkeleton,
} from './dashboard-skeletons'

export default function DashboardLoading() {
  return (
    <PageContainer className="flex flex-col gap-8 py-8">
      <DashboardHeaderSkeleton />
      <PaymentsSkeleton />
      <SubscriptionsSkeleton />
      <NextAppointmentSkeleton />
      <OnlineBookingsSkeleton />
    </PageContainer>
  )
}
