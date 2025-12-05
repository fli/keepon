import { Fragment, Suspense } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

import { PageContainer } from '@/components/page-container'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumbs'

import { loadClientsServer } from '../../clients/actions'
import { loadCreditPacks } from '../../dashboard/sell/credit-pack/actions'

type Crumb = {
  href: Route
  label: string
}

const TITLE_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  clients: 'Clients',
  finance: 'Finance',
  sales: 'Sales',
  sell: 'Sell',
  'credit-pack': 'Credit pack',
  settings: 'Settings',
  users: 'Users',
  add: 'Add',
  make: 'Make',
}

function formatSegment(segment: string, parent?: string): string {
  if (segment === 'add' && parent === 'clients') return 'Add client'
  if (segment === 'make' && parent === 'sales') return 'Collect payment'
  if (segment === 'sell' && parent === 'dashboard') return 'Sell'
  if (segment === 'credit-pack' && parent === 'sell') return 'Credit pack'
  if (segment === 'pack' && parent === 'credit-pack') return 'Credit pack'

  const mapped = TITLE_MAP[segment]
  if (mapped) return mapped

  const words = segment
    .replace(/-/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))

  return words.join(' ') || segment
}

async function buildCrumbs(segments: string[]): Promise<Crumb[]> {
  const normalized = segments.filter(Boolean)

  if (normalized.length === 0) return []

  if (normalized[0] === 'dashboard' && normalized[1] === 'sell' && normalized[2] === 'credit-pack') {
    return buildSellCreditPackCrumbs(normalized)
  }

  const dynamicLabels: Record<number, string | undefined> = {}

  if (normalized[0] === 'clients' && normalized[1] && normalized[1] !== 'add') {
    const clients = (await loadClientsServer()) ?? []
    const match = clients.find((client) => client.id === normalized[1])
    if (match) {
      dynamicLabels[1] = [match.firstName, match.lastName].filter(Boolean).join(' ').trim() || 'Client'
    }
  }

  let path = ''
  const crumbs: Crumb[] = normalized.map((segment, index) => {
    path += `/${segment}`
    const label = dynamicLabels[index] ?? formatSegment(segment, normalized[index - 1])
    return { href: path as Route, label }
  })

  return crumbs
}

async function buildSellCreditPackCrumbs(normalized: string[]): Promise<Crumb[]> {
  const [, , , clientId, maybePackKeyword, productId] = normalized

  const clients = clientId ? (await loadClientsServer()) ?? [] : []
  const packs = maybePackKeyword === 'pack' && productId ? await loadCreditPacks() : []

  const clientName = clientId
    ? clients.find((client) => client.id === clientId)
    : undefined

  const packName = maybePackKeyword === 'pack' && productId
    ? packs.find((pack) => pack.id === productId)
    : undefined

  const dashboard: Crumb = { href: '/dashboard' as Route, label: 'Dashboard' }
  const flowRoot: Crumb = { href: '/dashboard/sell/credit-pack' as Route, label: 'Sell credit pack' }

  // Step 1 – choose client (landing page)
  if (!clientId) {
    return [dashboard, flowRoot, { href: flowRoot.href, label: 'Choose client' }]
  }

  const chooseClientLabel = clientName
    ? `Choose client (${[clientName.firstName, clientName.lastName].filter(Boolean).join(' ').trim() || 'Client'})`
    : 'Choose client'

  // Step 2 – choose pack
  if (maybePackKeyword !== 'pack' || !productId) {
    return [
      dashboard,
      flowRoot,
      { href: flowRoot.href, label: chooseClientLabel },
      { href: `/dashboard/sell/credit-pack/${clientId}` as Route, label: 'Choose credit pack' },
    ]
  }

  const choosePackLabel = packName?.name ? `Choose credit pack (${packName.name})` : 'Choose credit pack'

  // Step 3 – payment
  return [
    dashboard,
    flowRoot,
    { href: flowRoot.href, label: chooseClientLabel },
    { href: `/dashboard/sell/credit-pack/${clientId}` as Route, label: choosePackLabel },
    { href: `/dashboard/sell/credit-pack/${clientId}/pack/${productId}` as Route, label: 'Payment' },
  ]
}

export default async function BreadcrumbsSlot({ params }: { params: Promise<{ segments?: string[] }> }) {
  return (
    <Suspense fallback={null}>
      <BreadcrumbsContent params={params} />
    </Suspense>
  )
}

async function BreadcrumbsContent({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params
  const crumbs = await buildCrumbs(segments)

  if (crumbs.length === 0) {
    return null
  }

  return (
    <PageContainer className="py-3">
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1
            const isRoot = index === 0

            return (
              <Fragment key={`${crumb.href}-${index}`}>
                <BreadcrumbItem>
                  {!isLast || isRoot ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {!isLast ? <BreadcrumbSeparator /> : null}
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </PageContainer>
  )
}
