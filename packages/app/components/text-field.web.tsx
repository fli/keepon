import React, { forwardRef } from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
}

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, error, className, ...rest },
  ref
) {
  const inputClasses = ['input', className].filter(Boolean).join(' ')

  return (
    <label className="flex w-full flex-col gap-1 text-sm font-medium text-[var(--color-text)]">
      <span>{label}</span>
      <input ref={ref} className={inputClasses} aria-invalid={Boolean(error)} {...rest} />
      {error ? <span className="text-xs text-[var(--color-danger)]">{error}</span> : null}
    </label>
  )
})
