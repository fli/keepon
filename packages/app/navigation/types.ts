import type { NavigatorScreenParams } from '@react-navigation/native'

export type ClientsStackParamList = {
  ClientsHome: undefined
  ClientDetail: { clientId: string }
  AddClient: { status?: string } | undefined
}

export type TabParamList = {
  DashboardTab: undefined
  CalendarTab: undefined
  FinanceTab: undefined
  ClientsTab: NavigatorScreenParams<ClientsStackParamList> | undefined
  SettingsTab: undefined
}

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>
  MakeSale: undefined
  AuthLogin: undefined
  AuthSignup: undefined
  UserDetail: { userId?: string; id?: string }
}
