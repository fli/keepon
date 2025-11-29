'use client'

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Host } from '@expo/ui/swift-ui'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useRouter, useSearchParams } from 'app/navigation'
import type { ClientsStackParamList } from 'app/navigation/types'
import { useAuth } from 'app/provider/auth'
import { createClient, type Client, type CreateClientPayload } from 'app/services/api'
import { useTheme } from 'app/theme'
import {
  emptyForm,
  isStatusFilter,
  normalizeStatus,
  optionalValue,
  statusOptions,
  type StatusFilter,
} from './shared'

type Props = {
  createClientAction?: (payload: CreateClientPayload) => Promise<Client>
}

export function AddClientScreen({ createClientAction }: Props) {
  const router = useRouter()
  const navigation = useNavigation<NativeStackNavigationProp<ClientsStackParamList>>()
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const auth = useAuth()
  const queryClient = useQueryClient()

  const searchParams = useSearchParams()
  const initialStatus = useMemo<StatusFilter>(() => {
    const raw = searchParams?.get('status') ?? null
    return isStatusFilter(raw) ? raw : 'current'
  }, [searchParams])

  const [form, setForm] = useState<CreateClientPayload>({ ...emptyForm, status: initialStatus })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm({ ...emptyForm, status: initialStatus })
    setError(null)
  }, [initialStatus])

  const resetForm = useCallback(
    (nextStatus: StatusFilter = initialStatus) => {
      setForm({ ...emptyForm, status: nextStatus })
    },
    [initialStatus]
  )

  const handleCreated = useCallback(
    (client: Client) => {
      resetForm(normalizeStatus(client.status))
      void queryClient.invalidateQueries({ queryKey: ['clients', auth.session?.trainerId] })
      router.replace(`/clients/${client.id}`)
    },
    [auth.session?.trainerId, queryClient, resetForm, router]
  )

  const createMutation = useMutation<Client, Error, CreateClientPayload>({
    mutationFn: async payload => {
      if (createClientAction) {
        return createClientAction(payload)
      }
      if (!auth.session) {
        throw new Error('Sign in to add clients')
      }
      return createClient(payload, auth.session)
    },
    onSuccess: handleCreated,
    onError: err => setError(err.message),
  })

  const handleSubmit = useCallback(() => {
    const firstName = form.firstName.trim()
    if (!auth.session && !createClientAction) {
      setError('Sign in to add a client')
      return
    }
    if (!firstName) {
      setError('Add at least a first name')
      return
    }

    setError(null)

    const payload: CreateClientPayload = {
      ...form,
      firstName,
      lastName: optionalValue(form.lastName),
      email: optionalValue(form.email),
      mobileNumber: optionalValue(form.mobileNumber),
      otherNumber: optionalValue(form.otherNumber),
      company: optionalValue(form.company),
      status: form.status ?? initialStatus,
    }

    createMutation.mutate(payload)
  }, [auth.session, createClientAction, createMutation, form, initialStatus])

  const handleCancel = useCallback(() => {
    router.back()
  }, [router])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Add client',
      unstable_headerLeftItems: () => [
        {
          key: 'cancel',
          type: 'button',
          label: 'Cancel',
          onPress: handleCancel,
          disabled: createMutation.isPending,
        },
      ],
      unstable_headerRightItems: () => [
        {
          key: 'save',
          type: 'button',
          label: 'Save',
          onPress: handleSubmit,
          disabled: createMutation.isPending,
        },
      ],
    })
  }, [createMutation.isPending, handleCancel, handleSubmit, navigation])

  return (
    <Host useViewportSizeMeasurement style={styles.host}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          bottomOffset={theme.spacing.lg}
        >
          <Field
            label="First name"
            value={form.firstName}
            onChangeText={text => setForm(prev => ({ ...prev, firstName: text }))}
            autoFocus
            returnKeyType="next"
            placeholder="Required"
            theme={theme}
          />
          <Field
            label="Last name"
            value={form.lastName ?? ''}
            onChangeText={text => setForm(prev => ({ ...prev, lastName: text }))}
            returnKeyType="next"
            theme={theme}
          />
          <Field
            label="Email"
            value={form.email ?? ''}
            onChangeText={text => setForm(prev => ({ ...prev, email: text }))}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            theme={theme}
          />
          <Field
            label="Mobile"
            value={form.mobileNumber ?? ''}
            onChangeText={text => setForm(prev => ({ ...prev, mobileNumber: text }))}
            keyboardType="phone-pad"
            returnKeyType="next"
            theme={theme}
          />
          <Field
            label="Company"
            value={form.company ?? ''}
            onChangeText={text => setForm(prev => ({ ...prev, company: text }))}
            returnKeyType="done"
            theme={theme}
          />

          <Text style={styles.sectionLabel}>Status</Text>
          <View style={styles.statusRow}>
            {statusOptions.map(option => {
              const active = form.status === option.id
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  onPress={() => setForm(prev => ({ ...prev, status: option.id }))}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{option.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </Host>
  )
}

type FieldProps = {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  returnKeyType?: React.ComponentProps<typeof TextInput>['returnKeyType']
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize']
  autoCorrect?: boolean
  theme: ReturnType<typeof useTheme>['theme']
}

function Field({ label, value, onChangeText, placeholder, theme, ...rest }: FieldProps) {
  const styles = fieldStyles(theme)
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.secondaryText}
        style={styles.input}
        {...rest}
      />
    </View>
  )
}

const fieldStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    wrapper: { gap: 6 },
    label: {
      color: theme.colors.secondaryText,
      fontSize: 14,
      fontWeight: '600',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radii.md,
      color: theme.colors.text,
      fontSize: 16,
    },
  })

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    host: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    sectionLabel: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
      fontSize: 14,
    },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      alignItems: 'center',
    },
    pill: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    pillActive: {
      backgroundColor: theme.colors.text,
      borderColor: theme.colors.text,
    },
    pillLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    pillLabelActive: {
      color: theme.colors.background,
    },
    error: {
      color: '#ef4444',
      fontWeight: '700',
    },
  })
