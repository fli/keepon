'use client'

import { Button } from '@/components/ui/button'

const MESSAGE = 'Import from contacts is available in the native app.'

export function ImportClientsButton() {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        if (typeof globalThis.alert === 'function') {
          globalThis.alert(MESSAGE)
        } else {
          console.info(MESSAGE)
        }
      }}
    >
      Import
    </Button>
  )
}
