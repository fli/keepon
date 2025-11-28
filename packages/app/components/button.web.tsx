import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  loading?: boolean
}

export function Button({ label, loading, disabled, className, type, ...rest }: Props) {
  const isDisabled = disabled || loading
  const finalType = type ?? 'button'
  const classes = ['btn', 'btn-primary', className].filter(Boolean).join(' ')

  return (
    <button type={finalType} className={classes} disabled={isDisabled} {...rest}>
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      ) : null}
      <span>{label}</span>
    </button>
  )
}
