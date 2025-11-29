import type { NavigatorScreenParams } from '@react-navigation/native'
import type { AppStackParamList, ClientsStackParamList, TabParamList } from './types'

type NavigationTarget =
  | {
      kind: 'tab'
      tab: keyof TabParamList
      params?: TabParamList[keyof TabParamList]
    }
  | {
      kind: 'stack'
      screen: Exclude<keyof AppStackParamList, 'Tabs'>
      params?: Record<string, unknown>
    }

export function resolveNavigationTarget(path: string): NavigationTarget {
  const safePath = path || '/'
  const url = toURL(safePath)
  const pathname = stripTrailingSlash(url.pathname)

  if (pathname === '/' || pathname === '') return tab('DashboardTab')
  if (pathname === '/dashboard') return tab('DashboardTab')
  if (pathname === '/calendar') return tab('CalendarTab')
  if (pathname === '/finance') return tab('FinanceTab')
  if (pathname === '/clients') return tab('ClientsTab', nested('ClientsHome'))
  if (pathname === '/settings') return tab('SettingsTab')
  if (pathname.startsWith('/settings/services')) return tab('SettingsTab')

  if (pathname.startsWith('/clients/add')) {
    const status = url.searchParams.get('status') ?? undefined
    return tab('ClientsTab', nested('AddClient', status ? { status } : undefined))
  }

  const clientMatch = pathname.match(/^\/clients\/([^/]+)$/)
  if (clientMatch) {
    const [, rawClientId] = clientMatch
    return tab('ClientsTab', nested('ClientDetail', { clientId: decodeURIComponent(rawClientId ?? '') }))
  }

  if (pathname.startsWith('/sales/make')) {
    return stack('MakeSale')
  }

  if (pathname === '/auth' || pathname === '/login') {
    return stack('AuthLogin')
  }

  if (pathname === '/signup' || pathname === '/auth/create') {
    return stack('AuthSignup')
  }

  const userMatch = pathname.match(/^\/users\/([^/]+)$/)
  if (userMatch) {
    const [, rawUserId] = userMatch
    const userId = decodeURIComponent(rawUserId ?? '')
    return stack('UserDetail', { userId, id: userId })
  }

  return tab('DashboardTab')
}

function tab<T extends keyof TabParamList>(tab: T, params?: TabParamList[T]): NavigationTarget {
  return { kind: 'tab', tab, params }
}

function stack(
  screen: Exclude<keyof AppStackParamList, 'Tabs'>,
  params?: Record<string, unknown>
): NavigationTarget {
  return { kind: 'stack', screen, params }
}

function nested<T extends keyof ClientsStackParamList>(
  screen: T,
  params?: ClientsStackParamList[T]
): NavigatorScreenParams<ClientsStackParamList> {
  return { screen, params } as NavigatorScreenParams<ClientsStackParamList>
}

function toURL(path: string) {
  try {
    return new URL(path, 'https://keepon.local')
  } catch {
    return new URL('https://keepon.local')
  }
}

function stripTrailingSlash(pathname: string) {
  if (pathname.length <= 1) return pathname
  return pathname.replace(/\/+$/, '') || '/'
}
