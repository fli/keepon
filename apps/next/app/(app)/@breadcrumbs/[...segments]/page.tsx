import { Fragment } from 'react'
import Link from 'next/link'

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

type Crumb = {
  href: string
  label: string
}

const TITLE_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  clients: 'Clients',
  finance: 'Finance',
  sales: 'Sales',
  settings: 'Settings',
  users: 'Users',
  add: 'Add',
  make: 'Make',
}

function formatSegment(segment: string, parent?: string): string {
  if (segment === 'add' && parent === 'clients') return 'Add client'
  if (segment === 'make' && parent === 'sales') return 'Collect payment'

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

  const dynamicLabels: Record<number, string | undefined> = {}

  if (normalized[0] === 'clients' && normalized[1] && normalized[1] !== 'add') {
    const clients = (await loadClientsServer()) ?? []
    const match = clients.find((client) => client.id === normalized[1])
    if (match) {
      dynamicLabels[1] =
        [match.firstName, match.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Client'
    }
  }

  let path = ''
  const crumbs: Crumb[] = normalized.map((segment, index) => {
    path += `/${segment}`
    const label = dynamicLabels[index] ?? formatSegment(segment, normalized[index - 1])
    return { href: path, label }
  })

  return crumbs
}

export default async function BreadcrumbsSlot({
  params,
}: {
  params: Promise<{ segments?: string[] }>
}) {
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
              <Fragment key={crumb.href}>
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
