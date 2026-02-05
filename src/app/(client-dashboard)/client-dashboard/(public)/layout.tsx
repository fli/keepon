export default function ClientDashboardPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(circle at top, rgba(59,130,246,0.25), transparent 55%), radial-gradient(circle at 20% 20%, rgba(14,165,233,0.2), transparent 40%)',
          }}
        />
        <div className="relative w-full px-4 py-12 sm:px-6 lg:px-10">{children}</div>
      </div>
    </div>
  )
}
