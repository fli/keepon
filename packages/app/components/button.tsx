import { Pressable, Text, ActivityIndicator, PressableProps, StyleProp, StyleSheet } from 'react-native'
import { useTheme } from 'app/theme'

type Props = PressableProps & {
  label: string
  loading?: boolean
}

export function Button({ label, loading, disabled, style, ...rest }: Props) {
  const { theme } = useTheme()
  const combinedDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) =>
        ([
          styles(theme).base,
          pressed && styles(theme).pressed,
          combinedDisabled && styles(theme).disabled,
          style,
        ] as StyleProp)
      }
      disabled={combinedDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.text} />
      ) : (
        <Text style={styles(theme).label}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    base: {
      backgroundColor: theme.colors.text,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.85,
    },
    disabled: {
      opacity: 0.5,
    },
    label: {
      color: theme.colors.background,
      fontWeight: '700',
    },
  })
