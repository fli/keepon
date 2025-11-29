import { useCallback, useMemo } from 'react'
import {
  useNavigation,
  useRoute,
  StackActions,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native'

import type { AppStackParamList, ClientsStackParamList, TabParamList } from './types'
import { resolveNavigationTarget } from './path-map.native'

type AppNavigation = NavigationProp<ParamListBase>
type RouteParams = AppStackParamList & ClientsStackParamList

export function useRouter() {
  const navigation = useNavigation<AppNavigation>()

  const push = useCallback(
    (path: string) => navigateByPath(getRootNavigation(navigation), path, 'push'),
    [navigation]
  )

  const replace = useCallback(
    (path: string) => navigateByPath(getRootNavigation(navigation), path, 'replace'),
    [navigation]
  )

  const back = useCallback(() => navigation.goBack(), [navigation])

  return { push, replace, back }
}

export function useParams<T extends Record<string, string>>() {
  const route = useRoute<RouteProp<RouteParams, keyof RouteParams>>()
  return (route.params ?? {}) as unknown as T
}

export function useSearchParams() {
  const route = useRoute<RouteProp<RouteParams, keyof RouteParams>>()
  const params = useMemo(
    () => (route.params ?? {}) as Record<string, unknown>,
    [route.params]
  )

  return useMemo(() => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ) {
        search.set(key, String(value))
      }
    })
    return search
  }, [params])
}

type NavigateMethod = 'push' | 'replace'

function navigateByPath(navigation: AppNavigation, path: string, method: NavigateMethod) {
  const target = resolveNavigationTarget(path)

  if (target.kind === 'tab') {
    if (method === 'replace') {
      navigation.dispatch(StackActions.replace('Tabs', { screen: target.tab, params: target.params }))
    } else {
      navigation.navigate('Tabs', { screen: target.tab, params: target.params })
    }
    return
  }

  if (method === 'replace') {
    navigation.dispatch(StackActions.replace(target.screen, target.params))
  } else {
    navigation.navigate(target.screen, target.params)
  }
}

function getRootNavigation(navigation: AppNavigation): AppNavigation {
  let current: AppNavigation = navigation
  while (current.getParent) {
    const parent = current.getParent<AppNavigation>()
    if (!parent) break
    current = parent
  }
  return current
}

// Keep TabParamList referenced so TS doesn't tree-shake types out in consumers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _tabList: TabParamList | null = null
