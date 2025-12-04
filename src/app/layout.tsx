import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Keepon',
  description: 'Keepon web app',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'root min-h-screen bg-background text-foreground font-sans antialiased'
        )}
      >
        <div className="min-h-screen flex flex-col">
          <Suspense fallback={null}>{children}</Suspense>
        </div>
      </body>
    </html>
  )
}
