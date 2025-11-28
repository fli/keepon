'use client'

import { Pressable, Text, StyleProp, StyleSheet, type ViewStyle } from 'react-native'
import { useTheme } from 'app/theme'

export function SecondaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string
  disabled?: boolean
  onPress?: () => void
}) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => {
        const stateStyles: StyleProp<ViewStyle> = [
          styles.secondaryButton,
          pressed ? styles.itemPressed : null,
          disabled ? styles.disabled : null,
        ]
        return stateStyles
      }}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    secondaryButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    itemPressed: {
      opacity: 0.9,
    },
    disabled: {
      opacity: 0.5,
    },
  })
