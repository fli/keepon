import { redirect } from 'next/navigation'

import { ClientDashboardShell } from '@/components/client-dashboard/Shell'
import { resolveBrandColor } from '@/lib/client-dashboard/brand'
import { requireClientDashboardSession } from '@/server/client-dashboard/auth'
import { getClientProfile, getServiceProvider, getStripeAccountSummary } from '@/server/client-dashboard/queries'

export default async function ClientDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireClientDashboardSession()

  const [serviceProvider, clientProfile, stripeAccount] = await Promise.all([
    getServiceProvider(),
    getClientProfile(),
    getStripeAccountSummary().catch(() => null),
  ])

  const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? null

  if (!clientProfile?.email) {
    redirect('/client-dashboard/login')
  }

  const name =
    serviceProvider.businessName?.trim() ||
    `${serviceProvider.firstName.trim()}${serviceProvider.lastName ? ` ${serviceProvider.lastName.trim()}` : ''}`.trim()

  return (
    <ClientDashboardShell
      serviceProvider={{
        name,
        logoUrl: serviceProvider.businessLogoUrl ?? null,
        brandColor: resolveBrandColor(serviceProvider.brandColor),
      }}
      clientEmail={clientProfile.email}
      stripePublishableKey={stripePublishableKey}
      stripeAccount={stripeAccount}
    >
      {children}
    </ClientDashboardShell>
  )
}
