import { useCallback } from 'react'

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { Button, Platform, Text } from 'react-native'

import { LoginScreen } from 'app/features/auth/login-screen'
import { CreateAccountScreen } from 'app/features/auth/create-account-screen'
import { DashboardScreen } from 'app/features/dashboard/screen'
import { CalendarScreen } from 'app/features/calendar/screen'
import { FinanceScreen } from 'app/features/finance/screen'
import { ClientsScreen } from 'app/features/clients/screen'
import { ClientDetailScreen } from 'app/features/clients/client-detail-screen'
import { AddClientScreen } from 'app/features/clients/add-client-screen'
import { SettingsScreen } from 'app/features/settings/screen'
import { MakeSaleScreen } from 'app/features/sales/make-sale-screen'
import { useAuth } from 'app/provider/auth'

export type RootStackParamList = {
  auth: undefined
  signup: undefined
  app:
    | undefined
    | {
        screen?: string
        params?: unknown
      }
  makeSale: undefined
  addClient: { status?: string } | undefined
}

type ClientsStackParamList = {
  ClientsHome: undefined
  ClientDetail: { clientId: string }
}

type TabParamList = {
  Dashboard: undefined
  Calendar: undefined
  Finance: undefined
  Clients:
    | undefined
    | {
        screen?: keyof ClientsStackParamList
        params?: ClientsStackParamList[keyof ClientsStackParamList]
      }
  Settings: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tabs = createBottomTabNavigator<TabParamList>()
const ClientsStack = createNativeStackNavigator<ClientsStackParamList>()

const tabIcons: Record<keyof TabParamList, SFSymbol> = {
  Dashboard: 'chart.bar',
  Calendar: 'calendar',
  Finance: 'creditcard',
  Clients: 'person.2',
  Settings: 'gearshape',
}

const tabFallbackText: Record<keyof TabParamList, string> = {
  Dashboard: 'D',
  Calendar: 'C',
  Finance: 'F',
  Clients: 'C',
  Settings: 'S',
}

const renderTabIcon = (
  routeName: keyof TabParamList,
  color: string,
  size: number,
  focused: boolean
) => {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={tabIcons[routeName]}
        tintColor={color}
        size={size}
        weight={focused ? 'semibold' : 'regular'}
        fallback={
          <Text
            style={{
              color,
              fontSize: size * 0.9,
              fontWeight: focused ? '700' : '400',
            }}
          >
            {tabFallbackText[routeName]}
          </Text>
        }
      />
    )
  }

  return (
    <Text
      style={{
        color,
        fontSize: size * 0.9,
        fontWeight: focused ? '700' : '400',
      }}
    >
      {tabFallbackText[routeName]}
    </Text>
  )
}

const LoginWithNav = () => {
  const navigation = useNavigation()
  return (
    <LoginScreen onCreateAccount={() => navigation.navigate('signup' as never)} />
  )
}

const SignupWithNav = () => {
  const navigation = useNavigation()
  return (
    <CreateAccountScreen
      onAlreadyHaveAccount={() => navigation.navigate('auth' as never)}
    />
  )
}

const AddClientHeaderButton = ({ onPress }: { onPress: () => void }) => (
  <Button title="Add" accessibilityLabel="Add client" onPress={onPress} />
)

function ClientsStackScreen() {
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>()

  const handleAddClient = useCallback(() => {
    rootNavigation.navigate('addClient', { status: 'current' })
  }, [rootNavigation])

  return (
    <ClientsStack.Navigator
      screenOptions={{
        headerLargeTitle: Platform.OS === 'ios',
        headerTitle: 'Clients',
      }}
    >
      <ClientsStack.Screen
        name="ClientsHome"
        component={ClientsScreen}
        options={{
          headerRight: () => <AddClientHeaderButton onPress={handleAddClient} />,
          ...(Platform.OS === 'ios'
            ? {
                unstable_headerRightItems: ({ tintColor }) => [
                  {
                    type: 'button',
                    label: 'Add',
                    accessibilityLabel: 'Add client',
                    tintColor,
                    onPress: handleAddClient,
                  },
                ],
              }
            : undefined),
        }}
      />
      <ClientsStack.Screen
        name="ClientDetail"
        component={ClientDetailScreen}
        options={{
          headerTitle: 'Client details',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
    </ClientsStack.Navigator>
  )
}

function TabsNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color = '#111', size = 24, focused }) =>
          renderTabIcon(route.name, color, size, Boolean(focused)),
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} />
      <Tabs.Screen name="Calendar" component={CalendarScreen} />
      <Tabs.Screen name="Finance" component={FinanceScreen} />
      <Tabs.Screen name="Clients" component={ClientsStackScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  )
}

export function NativeNavigation() {
  const { token, ready } = useAuth()

  // Don't render navigation until auth state is loaded to avoid flicker
  if (!ready) {
    return <Text>Loading…</Text>
  }

  // Render separate stacks so switching auth state swaps the visible tree immediately
  if (!token) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth" component={LoginWithNav} />
        <Stack.Screen name="signup" component={SignupWithNav} />
      </Stack.Navigator>
    )
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="app" component={TabsNavigator} />
      <Stack.Screen
        name="makeSale"
        component={MakeSaleScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="addClient"
        component={AddClientScreen}
        options={{
          presentation: 'modal',
          headerShown: Platform.OS === 'ios',
          headerTitle: Platform.OS === 'ios' ? 'Add client' : undefined,
          headerBackVisible: Platform.OS === 'ios' ? false : undefined,
        }}
      />
    </Stack.Navigator>
  )
}
