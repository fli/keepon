import React, { useMemo } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { StatusBar } from 'expo-status-bar'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { View } from 'react-native'

import { Provider } from 'app/provider'
import { DashboardScreen } from 'app/features/dashboard/screen'
import { CalendarScreen } from 'app/features/calendar/screen'
import { FinanceScreen } from 'app/features/finance/screen'
import { ClientsScreen } from 'app/features/clients/screen'
import { ClientDetailScreen } from 'app/features/clients/client-detail-screen'
import { SettingsScreen } from 'app/features/settings/screen'
import { MakeSaleScreen } from 'app/features/sales/make-sale-screen'
import { AddClientScreen } from 'app/features/clients/add-client-screen'
import { LoginScreen } from 'app/features/auth/login-screen'
import { CreateAccountScreen } from 'app/features/auth/create-account-screen'
import { UserDetailScreen } from 'app/features/user/detail-screen'
import { Theme, ThemeName, useTheme } from 'app/theme'
import type { AppStackParamList, ClientsStackParamList, TabParamList } from 'app/navigation/types'

const Stack = createNativeStackNavigator<AppStackParamList>()
const ClientsStack = createNativeStackNavigator<ClientsStackParamList>()
const Tab = createBottomTabNavigator<TabParamList>()

const TAB_ICONS: Record<keyof TabParamList, SFSymbol> = {
  DashboardTab: 'square.grid.2x2.fill',
  CalendarTab: 'calendar',
  FinanceTab: 'chart.bar.fill',
  ClientsTab: 'person.2.fill',
  SettingsTab: 'gearshape.fill',
}

function Tabs({ theme, colorScheme }: { theme: Theme; colorScheme: ThemeName }) {
  const tabBarStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.systemBackground,
      borderTopColor: theme.colors.separator,
    }),
    [theme]
  )

  return (
    <Tab.Navigator
      initialRouteName="DashboardTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.systemBlue,
        tabBarInactiveTintColor: theme.colors.secondaryLabel,
        tabBarStyle,
        tabBarLabelStyle: {
          fontWeight: '700',
          letterSpacing: 0.1,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const symbol = TAB_ICONS[route.name]
          if (!symbol) return null

          return (
            <SymbolView
              name={symbol}
              size={size}
              tintColor={color}
              weight={focused ? 'semibold' : 'regular'}
              fallback={<View style={{ width: size, height: size }} />}
            />
          )
        },
      })}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="CalendarTab" component={CalendarScreen} options={{ title: 'Calendar' }} />
      <Tab.Screen name="FinanceTab" component={FinanceScreen} options={{ title: 'Finance' }} />
      <Tab.Screen name="ClientsTab" options={{ title: 'Clients' }}>
        {() => <ClientsNavigator theme={theme} colorScheme={colorScheme} />}
      </Tab.Screen>
      <Tab.Screen name="SettingsTab" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  )
}

function ClientsNavigator({ theme, colorScheme }: { theme: Theme; colorScheme: ThemeName }) {
  return (
    <ClientsStack.Navigator
      initialRouteName="ClientsHome"
      screenOptions={{
        // Keep backgrounds aligned with the system look without hard-coding tints.
        contentStyle: { backgroundColor: theme.colors.systemBackground },
        headerBlurEffect: colorScheme === 'dark' ? 'systemMaterialDark' : 'systemMaterial',
      }}
    >
      <ClientsStack.Screen
        name="ClientsHome"
        component={ClientsScreen}
        options={({ navigation }) => ({
          title: 'Clients',
          headerLargeTitle: true,
          headerLargeTitleStyle: { color: theme.colors.label },
          headerShadowVisible: false,
          unstable_headerRightItems: () => [
            {
              key: 'add-client',
              type: 'button',
              label: 'Add',
              onPress: () => navigation.push('AddClient'),
            },
          ],
        })}
      />
      <ClientsStack.Screen
        name="ClientDetail"
        component={ClientDetailScreen}
        options={{ title: 'Client' }}
      />
      <ClientsStack.Screen
        name="AddClient"
        component={AddClientScreen}
        options={{ title: 'Add client', presentation: 'modal' }}
      />
    </ClientsStack.Navigator>
  )
}

export default function App() {
  const { theme, colorScheme } = useTheme()

  const navigationTheme: NavigationTheme = useMemo(() => {
    const base = colorScheme === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.systemBlue ?? base.colors.primary,
        background: theme.colors.systemBackground ?? base.colors.background,
        card: theme.colors.secondarySystemBackground ?? base.colors.card,
        text: theme.colors.label ?? base.colors.text,
        border: theme.colors.separator ?? base.colors.border,
        notification: theme.colors.systemRed ?? base.colors.notification,
      },
    }
  }, [colorScheme, theme])

  const rootStyle = useMemo(
    () => ({ flex: 1, backgroundColor: theme.colors.systemBackground }),
    [theme]
  )

  return (
    <GestureHandlerRootView style={rootStyle}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer theme={navigationTheme}>
        <Provider>
          <Stack.Navigator
            initialRouteName="Tabs"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.systemBackground },
            }}
          >
            <Stack.Screen name="Tabs">
              {() => <Tabs theme={theme} colorScheme={colorScheme} />}
            </Stack.Screen>
            <Stack.Screen
              name="MakeSale"
              component={MakeSaleScreen}
              options={{ headerShown: true, title: 'Make sale' }}
            />
            <Stack.Screen
              name="AuthLogin"
              component={LoginScreen}
              options={{ headerShown: true, title: 'Sign in' }}
            />
            <Stack.Screen
              name="AuthSignup"
              component={CreateAccountScreen}
              options={{ headerShown: true, title: 'Create account' }}
            />
            <Stack.Screen
              name="UserDetail"
              component={UserDetailScreen}
              options={{ headerShown: true, title: 'User' }}
            />
          </Stack.Navigator>
        </Provider>
      </NavigationContainer>
    </GestureHandlerRootView>
  )
}
