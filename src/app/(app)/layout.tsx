import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { WebTopNav } from '../../components/web-top-nav'

export default function AppShellLayout({ children, breadcrumbs }: { children: ReactNode; breadcrumbs: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <WebTopNav />
      </Suspense>
      <Suspense fallback={null}>{breadcrumbs}</Suspense>
      <Suspense fallback={null}>{children}</Suspense>
    </>
  )
}
