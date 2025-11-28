import React from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StyleSheet, Text, View } from 'react-native'
import { Provider } from 'app/provider'
import { ScreenPropsProvider } from 'app/navigation/native/screen-props'

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

const screens = {
  dashboard: DashboardScreen,
  calendar: CalendarScreen,
  finance: FinanceScreen,
  clients: ClientsScreen,
  clientDetail: ClientDetailScreen,
  settings: SettingsScreen,
  makeSale: MakeSaleScreen,
  addClient: AddClientScreen,
  authLogin: LoginScreen,
  authSignup: CreateAccountScreen,
}

type RouteKey = keyof typeof screens

function isRouteKey(value: unknown): value is RouteKey {
  return typeof value === 'string' && value in screens
}

export default function App(props: Record<string, unknown> & { route?: string }) {
  const route: RouteKey = isRouteKey(props.route) ? props.route : 'dashboard'
  const Screen = screens[route] ?? UnknownScreen

  return (
    <GestureHandlerRootView style={styles.root}>
      <Provider>
        <ScreenPropsProvider value={props}>
          <Screen />
        </ScreenPropsProvider>
      </Provider>
    </GestureHandlerRootView>
  )
}

function UnknownScreen({ route }: { route?: string }) {
  return (
    <View style={styles.unknownContainer}>
      <Text style={styles.title}>Unknown route</Text>
      <Text style={styles.body}>{`Received route "${route ?? 'undefined'}"`}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e2e8f0',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    color: '#cbd5e1',
    marginBottom: 8,
  },
  unknownContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
})
