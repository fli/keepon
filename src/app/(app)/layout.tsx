import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { AppSidebar, AppSidebarMobile } from '@/components/app-sidebar'

export default function AppShellLayout({ children, breadcrumbs }: { children: ReactNode; breadcrumbs: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      <Suspense fallback={null}>
        <AppSidebar />
      </Suspense>
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-2 border-b bg-background/90 px-6 py-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur md:hidden">
          <Suspense fallback={null}>
            <AppSidebarMobile />
          </Suspense>
        </header>
        <main className="flex-1">
          <Suspense fallback={null}>{breadcrumbs}</Suspense>
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </div>
  )
}
