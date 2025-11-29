import React from 'react'
import {
  Host,
  Form,
  VStack,
  HStack,
  ZStack,
  Group,
  Text,
  Divider,
  List,
  Section,
  ContentUnavailableView,
  Spacer,
  GlassEffectContainer,
  CircularProgress,
  LinearProgress,
  Switch,
  Button as ExpoButton,
  TextField as ExpoTextField,
  SecureField,
} from '@expo/ui/swift-ui'
import { padding, cornerRadius, shadow, frame } from '@expo/ui/swift-ui/modifiers'
import type {
  VStackProps,
  HStackProps,
  ListProps,
  SectionProps,
  SwitchProps,
  CircularProgressProps,
  LinearProgressProps,
  ButtonProps,
  TextProps,
  TextFieldProps as ExpoTextFieldProps,
  SecureFieldProps,
} from '@expo/ui/swift-ui'
import { ProgressView, TextField as SwiftTextField, SecureField as SwiftSecureField } from 'swiftui-react-native'

export const BackgroundColor = '#0b1220'
export const CardColor = '#111827'
export const AccentColor = '#38bdf8'
export const SubtleText = '#9ca3af'

export type ScreenProps = {
  title?: string
  subtitle?: string
  children: React.ReactNode
  scrollEnabled?: boolean
}

export function Screen({ title, subtitle, children, scrollEnabled = true }: ScreenProps) {
  return (
    <Host useViewportSizeMeasurement style={{ flex: 1, backgroundColor: BackgroundColor }}>
      <Form
        scrollEnabled={scrollEnabled}
        modifiers={[
          padding({ horizontal: 16, vertical: 12 }),
          frame({ maxHeight: Infinity, maxWidth: Infinity, alignment: 'top' }),
        ]}
      >
        <VStack spacing={12}>
          {title ? (
            <VStack spacing={4}>
              <Text weight="semibold" size={22} color="white">
                {title}
              </Text>
              {subtitle ? (
                <Text color={SubtleText} size={16} lineLimit={2}>
                  {subtitle}
                </Text>
              ) : null}
            </VStack>
          ) : null}
          {children}
        </VStack>
      </Form>
    </Host>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <GlassEffectContainer
      modifiers={[
        cornerRadius(14),
        shadow({ radius: 6, y: 2, color: '#0f172a' }),
        padding({ all: 14 }),
      ]}
    >
      {children}
    </GlassEffectContainer>
  )
}

// Re-export commonly used primitives so screens avoid react-native imports.
export { VStack, HStack, ZStack, Group, List, Section, Spacer, Divider, ContentUnavailableView }

export function TextBody(props: TextProps) {
  return <Text {...props} color={props.color ?? 'white'} size={props.size ?? 16} />
}

export function TitleText(props: TextProps) {
  return <Text {...props} weight={props.weight ?? 'semibold'} size={props.size ?? 20} color={props.color ?? 'white'} />
}

export function CaptionText(props: TextProps) {
  return <Text {...props} color={props.color ?? SubtleText} size={props.size ?? 14} />
}

export function PrimaryButton(props: ButtonProps & { loading?: boolean }) {
  const { loading, children, ...rest } = props
  return (
    <ExpoButton
      {...rest}
      variant="borderedProminent"
      controlSize="large"
      disabled={rest.disabled || loading}
      color={AccentColor}
      modifiers={[cornerRadius(12), padding({ vertical: 10, horizontal: 12 })]}
    >
      {loading ? 'Loading…' : children}
    </ExpoButton>
  )
}

export function SecondaryButton(props: ButtonProps) {
  return (
    <ExpoButton
      {...props}
      variant="bordered"
      controlSize="regular"
      color="white"
      modifiers={[cornerRadius(10), padding({ vertical: 8, horizontal: 10 })]}
    />
  )
}

export type SwiftTextFieldProps = ExpoTextFieldProps & {
  secureTextEntry?: boolean
  value?: string
  onChangeText?: (value: string) => void
  label?: string
  error?: string | null
}

export function TextField(props: SwiftTextFieldProps) {
  const { secureTextEntry, onChangeText, value, label, error, ...rest } = props
  const spacing = label || error ? 4 : 0

  const commonModifiers = { padding: { horizontal: 10, vertical: 8 }, cornerRadius: 10 }
  let field: React.ReactNode

  // swiftui-react-native supports controlled values; fall back to expo text field for simple cases.
  if (typeof value === 'string' || typeof onChangeText === 'function') {
    const Field = secureTextEntry ? SwiftSecureField : SwiftTextField
    field = (
      <Field
        text={value ?? ''}
        onChange={onChangeText}
        placeholder={rest.placeholder}
        padding={commonModifiers.padding}
        cornerRadius={commonModifiers.cornerRadius}
      />
    )
  }
  const FieldExpo = secureTextEntry ? SecureField : ExpoTextField
  field ??= (
    <FieldExpo
      {...rest}
      modifiers={[cornerRadius(commonModifiers.cornerRadius), padding(commonModifiers.padding)]}
    />
  )

  return (
    <VStack spacing={spacing}>
      {label ? (
        <TitleText size={15} color="white">
          {label}
        </TitleText>
      ) : null}
      {field}
      {error ? <CaptionText color="#f87171">{error}</CaptionText> : null}
    </VStack>
  )
}

export function LoadingSpinner(props: CircularProgressProps) {
  return <CircularProgress progress={props.progress ?? null} color={props.color ?? AccentColor} />
}

export function LinearMeter(props: LinearProgressProps) {
  return <LinearProgress progress={props.progress ?? null} color={props.color ?? AccentColor} />
}

export function Toggle(props: SwitchProps) {
  return <Switch {...props} color={props.color ?? AccentColor} />
}

export function SectionList(props: ListProps) {
  return <List {...props} listStyle={props.listStyle ?? 'insetGrouped'} />
}

export { ProgressView }

export type {
  ButtonProps,
  ExpoTextFieldProps,
  SecureFieldProps,
  SwitchProps,
  ListProps,
  SectionProps,
  VStackProps,
  HStackProps,
}
