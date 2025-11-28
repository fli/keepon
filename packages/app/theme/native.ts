import { useColorScheme } from 'react-native'
import { useMemo } from 'react'

import { designTokens, defaultThemeName, Theme, ThemeName } from './tokens'

export type UseThemeResult = {
  theme: Theme
  colorScheme: ThemeName
}

export function useTheme(): UseThemeResult {
  const system = useColorScheme()
  const colorScheme: ThemeName =
    system === 'dark' || system === 'light' ? system : defaultThemeName

  const theme = useMemo(() => designTokens[colorScheme], [colorScheme])

  return { theme, colorScheme }
}
