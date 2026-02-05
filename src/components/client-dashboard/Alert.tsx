import { cn } from '@/lib/utils'

const toneStyles = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
}

export function Alert({
  tone = 'info',
  title,
  description,
  className,
}: {
  tone?: keyof typeof toneStyles
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn('rounded-lg border px-3 py-2 text-sm', toneStyles[tone], className)}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <div className="font-medium">{title}</div>
      {description ? <div className="text-xs text-current/80">{description}</div> : null}
    </div>
  )
}
