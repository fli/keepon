import React from 'react'

type Props = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
}

export function Card({ padded = true, className, children, ...rest }: Props) {
  const classes = ['card', padded ? 'card-padded' : null, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
