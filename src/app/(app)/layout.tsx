import type { ReactNode } from 'react'

import { WebTopNav } from '../../components/web-top-nav'

export default function AppShellLayout({
  children,
  breadcrumbs,
}: {
  children: ReactNode
  breadcrumbs: ReactNode
}) {
  return (
    <>
      <WebTopNav />
      {breadcrumbs}
      {children}
    </>
  )
}
