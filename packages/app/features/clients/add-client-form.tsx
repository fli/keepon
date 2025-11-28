'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import { Pressable, Text, View, Platform, StyleSheet } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { SecondaryButton } from 'app/components/secondary-button'
import { TextField } from 'app/components/text-field'
import { useAuth } from 'app/provider/auth'
import { createClient, type Client, type CreateClientPayload } from 'app/services/api'
import { useTheme } from 'app/theme'
import {
  emptyForm,
  normalizeStatus,
  optionalValue,
  statusOptions,
  type StatusFilter,
} from './shared'

type Props = {
  initialStatus: StatusFilter
  onCreated?: (client: Client) => void
  onClose: () => void
  createClientAction?: (payload: CreateClientPayload) => Promise<Client>
}

export type AddClientFormHandle = {
  submit: () => void
}

export const AddClientForm = forwardRef<AddClientFormHandle, Props>(function AddClientForm(
  { initialStatus, onCreated, onClose, createClientAction }: Props,
  ref
) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const auth = useAuth()
  const queryClient = useQueryClient()
  const isWeb = Platform.OS === 'web'
  const stackFields = true

  const initialForm = useMemo<CreateClientPayload>(
    () => ({ ...emptyForm, status: initialStatus }),
    [initialStatus]
  )

  const [form, setForm] = useState<CreateClientPayload>(initialForm)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setForm(initialForm)
    setFormError(null)
  }, [initialForm])

  const createMutation = useMutation<Client, Error, CreateClientPayload>({
    mutationFn: async (payload: CreateClientPayload) => {
      if (!auth.session) {
        throw new Error('Sign in to add clients')
      }
      return createClient(payload, auth.session)
    },
    onSuccess: created => {
      onCreated?.(created)
      setForm({ ...emptyForm, status: normalizeStatus(created.status) })
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['clients', auth.session?.trainerId] })
    },
    onError: err => {
      setFormError(err instanceof Error ? err.message : 'Unable to add client')
    },
  })

  const [webPending, setWebPending] = useState(false)

  const handleSubmit = useCallback(() => {
    const firstName = form.firstName.trim()
    if (!auth.session) {
      setFormError('Sign in to add a client')
      return
    }
    if (!firstName) {
      setFormError('Add at least a first name')
      return
    }

    setFormError(null)

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

    if (isWeb && createClientAction) {
      setWebPending(true)
      createClientAction(payload)
        .then(created => {
          onCreated?.(created)
          setForm({ ...emptyForm, status: normalizeStatus(created.status) })
          setFormError(null)
        })
        .catch(err => {
          setFormError(err instanceof Error ? err.message : 'Unable to add client')
        })
        .finally(() => setWebPending(false))
      return
    }

    createMutation.mutate(payload)
  }, [auth.session, createClientAction, createMutation, form, initialStatus, isWeb, onCreated])

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit])

  return (
    <Card style={[styles.card, styles.addCard]}>
      <Text style={styles.cardTitle}>Add client</Text>
      <View style={stackFields ? styles.formColumn : styles.formRow}>
        <TextField
          label="First name"
          value={form.firstName}
          onChangeText={text => setForm(prev => ({ ...prev, firstName: text }))}
          style={styles.flexField}
        />
        <TextField
          label="Last name"
          value={form.lastName ?? ''}
          onChangeText={text => setForm(prev => ({ ...prev, lastName: text }))}
          style={styles.flexField}
        />
      </View>
      <View style={stackFields ? styles.formColumn : styles.formRow}>
        <TextField
          label="Email"
          value={form.email ?? ''}
          onChangeText={text => setForm(prev => ({ ...prev, email: text }))}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.flexField}
        />
        <TextField
          label="Mobile"
          value={form.mobileNumber ?? ''}
          onChangeText={text => setForm(prev => ({ ...prev, mobileNumber: text }))}
          keyboardType="phone-pad"
          style={styles.flexField}
        />
      </View>
      <TextField
        label="Company"
        value={form.company ?? ''}
        onChangeText={text => setForm(prev => ({ ...prev, company: text }))}
        style={styles.flexField}
      />

      <View style={styles.filterRow}>
        {statusOptions.map(option => (
          <PressableStatus
            key={`form-${option.id}`}
            active={form.status === option.id}
            label={option.label}
            onPress={() => setForm(prev => ({ ...prev, status: option.id }))}
          />
        ))}
      </View>

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

      <View style={stackFields ? styles.actionsColumn : styles.actionsRow}>
        <Button
          label="Save client"
          onPress={handleSubmit}
          loading={createMutation.isPending || webPending}
          disabled={createMutation.isPending || webPending}
          style={styles.primaryButton}
        />
        <SecondaryButton label="Cancel" onPress={onClose} />
      </View>
      <Text style={styles.helperText}>Matches the iOS add-client flow; more fields coming soon.</Text>
    </Card>
  )
})

function PressableStatus({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.smallPill, active && styles.pillActive]}
    >
      <Text style={[styles.pillLabel, active ? styles.pillLabelActive : styles.smallPillLabel]}>{label}</Text>
    </Pressable>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    card: {
      gap: theme.spacing.sm,
    },
    addCard: {
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    formRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    formColumn: {
      flexDirection: 'column',
      gap: theme.spacing.sm,
    },
    flexField: {
      flex: 1,
    },
    filterRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    smallPill: {
      paddingHorizontal: theme.spacing.sm,
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
    smallPillLabel: {
      color: theme.colors.text,
      fontWeight: '600',
    },
    pillLabelActive: {
      color: theme.colors.background,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    actionsColumn: {
      flexDirection: 'column',
      gap: theme.spacing.sm,
      alignItems: 'stretch',
    },
    primaryButton: {
      alignSelf: 'flex-start',
    },
    helperText: {
      color: theme.colors.secondaryText,
    },
    errorText: {
      color: '#dc2626',
      fontWeight: '700',
    },
  })
