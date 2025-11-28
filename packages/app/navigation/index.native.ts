import { useCallback, useMemo } from 'react'

import { nativeNavigation } from './native-module'
import { useScreenProps } from './native/screen-props'

export function useRouter() {
  const push = useCallback((path: string) => nativeNavigation.push(path), [])
  const replace = useCallback((path: string) => nativeNavigation.replace(path), [])
  const back = useCallback(() => nativeNavigation.back(), [])

  return { push, replace, back }
}

export function useParams<T extends Record<string, string>>() {
  const props = useScreenProps()
  return props as unknown as T
}

export function useSearchParams() {
  const props = useScreenProps()

  return useMemo(() => {
    const params = new URLSearchParams()
    Object.entries(props).forEach(([key, value]) => {
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
  }, [props])
}
