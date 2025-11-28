'use client'

import { useCallback, useMemo, useRef } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useSearchParams } from 'app/navigation'

import { SecondaryButton } from 'app/components/secondary-button'
import { KeyboardAvoidingView } from 'app/components/keyboard-avoiding-view'
import { useTheme } from 'app/theme'
import { AddClientForm, type AddClientFormHandle } from './add-client-form'
import { isStatusFilter, type StatusFilter } from './shared'
import type { Client, CreateClientPayload } from 'app/services/api'

type Props = {
  createClientAction?: (payload: CreateClientPayload) => Promise<Client>
  // Accepts modal/page layout flag for web parity; ignored on native.
  variant?: 'modal' | 'page'
}

export function AddClientScreen({ createClientAction }: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()
  const searchParams = useSearchParams()
  const isIos = Platform.OS === 'ios'
  const formRef = useRef<AddClientFormHandle>(null)

  const initialStatus = useMemo<StatusFilter>(() => {
    const raw = searchParams?.get('status') ?? null
    return isStatusFilter(raw) ? raw : 'current'
  }, [searchParams])

  const handleClose = useCallback(() => {
    if (Platform.OS === 'web') {
      router.replace('/clients')
    } else {
      router.back()
    }
  }, [router])

  const handleCreated = useCallback(
    (client: Client) => {
      router.replace(`/clients/${client.id}`)
    },
    [router]
  )

  if (isIos) {
    return (
      <SafeAreaView style={styles.iosSafeArea} edges={['bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            contentInsetAdjustmentBehavior="always"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.iosContent}
          >
            <AddClientForm
              ref={formRef}
              initialStatus={initialStatus}
              onCreated={handleCreated}
              onClose={handleClose}
              createClientAction={createClientAction}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <View style={[styles.backdrop]}>
      <Pressable style={styles.backdropPress} onPress={handleClose} accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.title}>Add client</Text>
          <SecondaryButton label="Close" onPress={handleClose} />
        </View>
        <AddClientForm
          ref={formRef}
          initialStatus={initialStatus}
          onCreated={handleCreated}
          onClose={handleClose}
          createClientAction={createClientAction}
        />
      </View>
    </View>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      padding: theme.spacing.lg,
    },
    iosSafeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    iosContent: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    flex: {
      flex: 1,
    },
    backdropPress: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    sheet: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.radii.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 12 },
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: theme.colors.text,
    },
  })
