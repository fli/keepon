import { useCallback, useState } from 'react'
import { Alert, Linking, Platform } from 'react-native'
import { logout } from 'app/services/api'
import { useRouter } from 'app/navigation'
import { useAuth } from 'app/provider/auth'
import type { SettingItem } from './data'

type SimpleAlert = (title: string, message?: string) => void

const safeNativeAlert: SimpleAlert | null =
  typeof (Alert as { alert?: SimpleAlert }).alert === 'function'
    ? (Alert as { alert: SimpleAlert }).alert
    : null

const showAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    const browserAlert =
      typeof (globalThis as { alert?: (msg?: string) => void }).alert === 'function'
        ? (globalThis as { alert: (msg?: string) => void }).alert
        : null
    if (browserAlert) {
      browserAlert(message ? `${title}\n\n${message}` : title)
    } else {
      console.info(`${title}: ${message ?? ''}`)
    }
    return
  }
  if (safeNativeAlert) {
    safeNativeAlert(title, message)
  }
}

export function useSettingsActions() {
  const router = useRouter()
  const { session, clearSession } = useAuth()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleAction = useCallback(
    async (item: SettingItem) => {
      const { action } = item

      switch (action.type) {
        case 'route': {
          router.push(action.href)
          return
        }
        case 'external': {
          try {
            await Linking.openURL(action.url)
          } catch {
            showAlert('Unable to open link', action.url)
          }
          return
        }
        case 'mailto': {
          const subject = action.subject ? `?subject=${encodeURIComponent(action.subject)}` : ''
          const url = `mailto:${action.email}${subject}`
          try {
            await Linking.openURL(url)
          } catch {
            showAlert('Unable to start email', action.email)
          }
          return
        }
        case 'systemSettings': {
          try {
            const openSettings = (Linking as { openSettings?: () => Promise<void> }).openSettings
            if (typeof openSettings === 'function') {
              await openSettings()
            } else {
              await Linking.openURL('app-settings:')
            }
          } catch {
            showAlert('Open settings', 'Open Keepon settings from the device Settings app.')
          }
          return
        }
        case 'comingSoon': {
          showAlert('Coming soon', action.hint ?? 'This screen is being rebuilt.')
          return
        }
        case 'logout': {
          if (pendingId) return
          setPendingId(item.id)
          try {
            if (session) {
              await logout(session)
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unable to sign out'
            showAlert('Sign out', message)
          } finally {
            await clearSession()
            setPendingId(null)
          }
          return
        }
        default: {
          showAlert('Not available', 'This action is not wired up yet.')
        }
      }
    },
    [router, session, clearSession, pendingId]
  )

  return { handleAction, pendingId }
}
