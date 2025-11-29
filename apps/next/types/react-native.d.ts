/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents */
declare module 'react-native' {
  import * as React from 'react'

  export type ViewStyle = React.CSSProperties & Record<string, unknown>
  export type TextStyle = React.CSSProperties & Record<string, unknown>

  export type StyleProp<T = React.CSSProperties | Record<string, unknown>> =
    | T
    | ReadonlyArray<StyleProp<T>>
    | null
    | undefined
    | false
    | ''

  export interface PressableStateCallbackType {
    pressed: boolean
    hovered?: boolean
    focused?: boolean
  }

  export interface TextProps
    extends React.HTMLAttributes<HTMLSpanElement>,
      Record<string, unknown> {
    style?: StyleProp
    onPress?: () => void
  }

  export interface ViewProps
    extends React.HTMLAttributes<HTMLDivElement>,
      Record<string, unknown> {
    style?: StyleProp
  }

  export type ScrollViewProps = ViewProps
  export interface TextInputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    style?: StyleProp
    onChangeText?: (text: string) => void
    keyboardType?: string
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
    autoCorrect?: any
    returnKeyType?: string
    secureTextEntry?: boolean
    multiline?: boolean
    numberOfLines?: number
    placeholderTextColor?: string
    maxLength?: number
  }
  export type LayoutChangeEvent = React.SyntheticEvent<Element>
  export type ScrollResponderMixin = Record<string, unknown>

  export interface PressableProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
      Record<string, unknown> {
    style?: StyleProp<any> | ((state: PressableStateCallbackType) => StyleProp<any>)
    children?: React.ReactNode
  }

  export const TextInput: React.ForwardRefExoticComponent<
    TextInputProps & React.RefAttributes<HTMLInputElement>
  >
  export const Text: React.ComponentType<TextProps>
  export const View: React.ComponentType<ViewProps>
  export const ScrollView: React.ComponentType<ScrollViewProps>
  export const Pressable: React.ComponentType<PressableProps>
  export const Switch: React.ComponentType<{ value?: boolean; onValueChange?: (value: boolean) => void; style?: StyleProp }>
  export const RefreshControl: React.ComponentType<{
    refreshing: boolean
    onRefresh: () => void
    tintColor?: string
  }>
  export type AlertHandler = (title: string, message?: string) => void
  export const Alert: {
    alert: AlertHandler
  }
  export const Linking: { openURL: (url: string) => Promise<void> }
  export const KeyboardAvoidingView: React.ComponentType<ViewProps>
  export const ActivityIndicator: React.ComponentType<ViewProps>
  export const Platform: {
    OS: string
    select: <T>(spec: { ios?: T; android?: T; web?: T; native?: T; default?: T }) =>
      | T
      | undefined
  }
  export const Animated: any
}
