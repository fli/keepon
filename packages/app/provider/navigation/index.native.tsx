import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type LinkingOptions,
} from '@react-navigation/native'
import * as Linking from 'expo-linking'
import { useMemo } from 'react'

import type { RootStackParamList } from 'app/navigation/native'
import { lightTheme, darkTheme, useTheme } from 'app/theme'

const createURL = Linking.createURL as (path: string) => string

export function NavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { colorScheme } = useTheme()

  const linking = useMemo<LinkingOptions<RootStackParamList>>(
    () => ({
      prefixes: [createURL('/')],
      config: {
        initialRouteName: 'auth',
        screens: {
          auth: 'auth',
          signup: 'signup',
          app: {
            path: '',
            screens: {
              Dashboard: '',
              Calendar: 'calendar',
              Finance: 'finance',
              Clients: {
                path: 'clients',
                screens: {
                  ClientsHome: '',
                  ClientDetail: ':clientId',
                },
              },
              Settings: 'settings',
            },
          },
          makeSale: 'sales/make',
          addClient: 'clients/add',
        },
      },
    }),
    []
  )

  const navigationTheme = useMemo(
    () => {
      const isDark = colorScheme === 'dark'
      const base = isDark ? DarkTheme : DefaultTheme
      const palette = isDark ? darkTheme.colors : lightTheme.colors

      return {
        ...base,
        colors: {
          ...base.colors,
          primary: palette.link ?? base.colors.primary,
          background: palette.background ?? base.colors.background,
          card: palette.surface ?? base.colors.card,
          text: palette.text ?? base.colors.text,
          border: palette.border ?? base.colors.border,
          notification: palette.systemRed ?? base.colors.notification,
        },
      }
    },
    [colorScheme]
  )

  return (
    <NavigationContainer linking={linking} theme={navigationTheme}>
      {children}
    </NavigationContainer>
  )
}
