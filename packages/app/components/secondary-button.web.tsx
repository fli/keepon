import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
}

export function SecondaryButton({ label, className, type, ...rest }: Props) {
  const finalType = type ?? 'button'
  const classes = ['btn', 'btn-secondary', className].filter(Boolean).join(' ')
  return (
    <button type={finalType} className={classes} {...rest}>
      {label}
    </button>
  )
}
