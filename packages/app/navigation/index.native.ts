import {
  StackActions,
  useLinkTo,
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'
import { useCallback, useMemo } from 'react'

import type { RootStackParamList } from './native'

type NativeRoute = RouteProp<RootStackParamList, keyof RootStackParamList>

type TabName = 'Dashboard' | 'Calendar' | 'Finance' | 'Clients' | 'Settings'

type StackRouteName = 'auth' | 'signup' | 'makeSale' | 'addClient'
type StackTarget<RouteName extends StackRouteName = StackRouteName> = {
  type: 'stack'
  name: RouteName
  params: RootStackParamList[RouteName]
}

type ParsedTarget =
  | StackTarget<'auth'>
  | StackTarget<'signup'>
  | StackTarget<'makeSale'>
  | StackTarget<'addClient'>
  | {
      type: 'tab'
      tab: TabName
      nested?: { screen: 'ClientsHome' | 'ClientDetail'; params?: object }
    }

const normalizePath = (path: string) => {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function parseTarget(path: string): ParsedTarget {
  const url = new URL(normalizePath(path), 'https://app.local')
  const [first, second] = url.pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
  const search = url.searchParams

  if (!first || first === 'dashboard') {
    return { type: 'tab', tab: 'Dashboard' }
  }

  if (first === 'calendar') return { type: 'tab', tab: 'Calendar' }
  if (first === 'finance') return { type: 'tab', tab: 'Finance' }
  if (first === 'settings') return { type: 'tab', tab: 'Settings' }

  if (first === 'clients') {
    if (second === 'add') {
      return {
        type: 'stack',
        name: 'addClient',
        params: { status: search.get('status') ?? undefined },
      }
    }

    if (second) {
      return {
        type: 'tab',
        tab: 'Clients',
        nested: { screen: 'ClientDetail', params: { clientId: second } },
      }
    }

    return { type: 'tab', tab: 'Clients', nested: { screen: 'ClientsHome' } }
  }

  if (first === 'sales' && second === 'make') {
    return { type: 'stack', name: 'makeSale', params: undefined }
  }

  if (first === 'auth') {
    return { type: 'stack', name: 'auth', params: undefined }
  }

  if (first === 'signup') {
    return { type: 'stack', name: 'signup', params: undefined }
  }

  // Default to dashboard tab
  return { type: 'tab', tab: 'Dashboard' }
}

export function useRouter() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>()
  const linkTo = useLinkTo()

  const push = useCallback(
    (path: string) => {
      const target = parseTarget(path)
      if (target.type === 'stack') {
        switch (target.name) {
          case 'addClient':
            navigation.navigate('addClient', target.params)
            return
          case 'makeSale':
            navigation.navigate('makeSale')
            return
          case 'auth':
            navigation.navigate('auth')
            return
          case 'signup':
            navigation.navigate('signup')
            return
        }
      }

      navigation.navigate(
        'app',
        target.nested
          ? {
              screen: target.tab,
              params: {
                screen: target.nested.screen,
                params: target.nested.params,
              },
            }
          : { screen: target.tab }
      )
    },
    [navigation]
  )

  const replace = useCallback(
    (path: string) => {
      const target = parseTarget(path)
      if (target.type === 'stack') {
        switch (target.name) {
          case 'addClient':
            navigation.dispatch(StackActions.replace('addClient', target.params))
            return
          case 'makeSale':
            navigation.dispatch(StackActions.replace('makeSale'))
            return
          case 'auth':
            navigation.dispatch(StackActions.replace('auth'))
            return
          case 'signup':
            navigation.dispatch(StackActions.replace('signup'))
            return
        }
      }

      navigation.dispatch(
        StackActions.replace(
          'app',
          target.nested
            ? {
                screen: target.tab,
                params: {
                  screen: target.nested.screen,
                  params: target.nested.params,
                },
              }
            : { screen: target.tab }
        )
      )
    },
    [navigation]
  )

  const back = useCallback(() => {
    navigation.goBack()
  }, [navigation])

  return useMemo(
    () => ({
      push,
      replace,
      back,
      linkTo, // keep linkTo available for any edge cases
    }),
    [back, linkTo, push, replace]
  )
}

export function useParams<T extends Record<string, string>>() {
  const route = useRoute<NativeRoute>()
  return (route.params ?? {}) as unknown as T
}

export function useSearchParams() {
  const route = useRoute<NativeRoute>()
  return useMemo(() => {
    const params = new URLSearchParams()
    Object.entries(route.params ?? {}).forEach(([key, value]) => {
      if (value == null) return
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        params.set(key, String(value))
      }
    })
    return params
  }, [route.params])
}
