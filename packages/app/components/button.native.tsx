import React from 'react'
import { Pressable, Text, StyleSheet } from 'react-native'

type Props = {
  label: string
  loading?: boolean
  disabled?: boolean
  onPress?: () => void
}

export function Button({ label, loading, disabled, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && !loading ? styles.buttonPressed : null,
      ]}
    >
      <Text style={styles.label}>{loading ? 'Loading…' : label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  label: {
    color: '#fff',
    fontWeight: '700',
  },
})
