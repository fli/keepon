import './globals.css'

export const metadata = {
  title: 'Keepon',
  description: 'Keepon web app',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-(--color-background) text-[var(--color-text)]">
        <div className="min-h-screen flex flex-col">{children}</div>
      </body>
    </html>
  )
}
