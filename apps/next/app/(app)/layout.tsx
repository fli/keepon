import type { ReactNode } from 'react'

import { WebTopNav } from '../../components/web-top-nav'

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WebTopNav />
      {children}
    </>
  )
}
