'use client'

import type { StripeCardElement } from '@stripe/stripe-js'
import { CardElement, type CardElementProps } from '@stripe/react-stripe-js'
import { useCallback, useEffect, useMemo, useState } from 'react'

const baseStyle = {
  base: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '16px',
    lineHeight: '24px',
    color: '#0f172a',
    '::placeholder': {
      color: '#94a3b8',
    },
  },
  invalid: {
    color: '#dc2626',
    '::placeholder': {
      color: '#fda4af',
    },
    iconColor: '#dc2626',
  },
}

export function StripeCardElement({ onReady, options, ...props }: CardElementProps) {
  const [element, setElement] = useState<StripeCardElement>()

  const mergedOptions = useMemo(() => {
    return {
      style: baseStyle,
      ...options,
    }
  }, [options])

  useEffect(() => {
    if (!element) {
      return
    }

    const updateFontSize = () => {
      const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
      const isLarge = width >= 640
      element.update({
        style: {
          base: {
            fontSize: isLarge ? '14px' : '16px',
            lineHeight: isLarge ? '20px' : '24px',
          },
        },
      })
    }

    updateFontSize()
    window.addEventListener('resize', updateFontSize)
    return () => {
      window.removeEventListener('resize', updateFontSize)
    }
  }, [element])

  const handleReady = useCallback(
    (cardElement: StripeCardElement) => {
      setElement(cardElement)
      onReady?.(cardElement)
    },
    [onReady]
  )

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-sm">
      <CardElement onReady={handleReady} options={mergedOptions} {...props} />
    </div>
  )
}
