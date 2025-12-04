import type { ReactNode } from 'react'

export default function ClientsLayout({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
