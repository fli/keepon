import React from 'react'
import { Pressable, Text, StyleSheet } from 'react-native'

type Props = {
  label: string
  disabled?: boolean
  onPress?: () => void
}

export function SecondaryButton({ label, ...rest }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7c7cc',
    backgroundColor: '#fff',
  },
  buttonPressed: {
    backgroundColor: '#f2f2f7',
  },
  label: {
    color: '#1c1c1e',
    fontWeight: '700',
  },
})
