'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

import {
  getSettingsSections,
  type SettingItem,
  type SettingSection,
} from '@/lib/app/features/settings/data'

import { logoutAction } from './actions'

type Tile = SettingItem & { section: SettingSection['title'] }

export function SettingsGrid() {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const sections = useMemo(
    () =>
      getSettingsSections().map((section) => ({
        ...section,
        data: section.data.map(
          (item) => ({ ...item, section: section.title } as Tile)
        ),
      })),
    []
  )

  const handleAction = (tile: Tile) => {
    if (isPending || pendingId) return

    const { action } = tile
    const done = () => setPendingId(null)

    switch (action.type) {
      case 'route':
        router.push(action.href)
        return
      case 'external':
        if (typeof window !== 'undefined') {
          window.location.assign(action.url)
        }
        return
      case 'mailto': {
        const subject = action.subject
          ? `?subject=${encodeURIComponent(action.subject)}`
          : ''
        const url = `mailto:${action.email}${subject}`
        if (typeof window !== 'undefined') {
          window.location.href = url
        }
        return
      }
      case 'systemSettings':
        if (typeof window !== 'undefined') {
          window.alert?.('Open Keepon in your device settings.')
        }
        return
      case 'comingSoon':
        if (typeof window !== 'undefined') {
          window.alert?.(action.hint ?? 'This option is being rebuilt.')
        }
        return
      case 'logout':
        setPendingId(tile.id)
        startTransition(async () => {
          try {
            await logoutAction()
            router.replace('/auth')
          } finally {
            done()
          }
        })
        return
      default:
        return
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {section.title}
            </p>
            <div className="ml-4 h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {section.data.map((tile) => (
              <Card
                key={tile.id}
                className={cn(
                  'group relative overflow-hidden border border-border/70 shadow-sm transition',
                  'hover:-translate-y-0.5 hover:shadow-md'
                )}
              >
                <CardHeader className="flex flex-row items-center gap-3 px-4 py-3">
                  <span
                    className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/60 text-base shadow-sm"
                    aria-hidden
                  >
                    {tile.glyph}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="text-base leading-tight">
                      {tile.title}
                    </CardTitle>
                    <CardDescription className="text-xs leading-snug text-muted-foreground">
                      {tile.subtitle}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 px-4 pb-3 pt-0">
                  <Button
                    size="sm"
                    variant={
                      tile.action.type === 'external' ? 'outline' : 'default'
                    }
                    onClick={() => handleAction(tile)}
                    disabled={isPending || pendingId === tile.id}
                    className="h-8 px-3 text-xs"
                  >
                    {actionLabel(tile.action.type)}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {tile.action.type === 'logout' ? 'Ends this session' : ' '}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function actionLabel(kind: SettingItem['action']['type']) {
  switch (kind) {
    case 'external':
      return 'Open'
    case 'mailto':
      return 'Email'
    case 'systemSettings':
      return 'Open settings'
    case 'comingSoon':
      return 'Details'
    case 'logout':
      return 'Sign out'
    case 'route':
    default:
      return 'Go'
  }
}
