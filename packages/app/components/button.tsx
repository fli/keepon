import { Pressable, Text, ActivityIndicator, PressableProps, StyleProp, StyleSheet, type ViewStyle } from 'react-native'
import { useTheme } from 'app/theme'

type Props = PressableProps & {
  label: string
  loading?: boolean
}

export function Button({ label, loading, disabled, style, ...rest }: Props) {
  const { theme } = useTheme()
  const themedStyles = styles(theme)
  const combinedDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => {
        const stateStyles: StyleProp<ViewStyle> = [
          themedStyles.base,
          pressed ? themedStyles.pressed : null,
          combinedDisabled ? themedStyles.disabled : null,
          style,
        ]
        return stateStyles
      }}
      disabled={combinedDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.text} />
      ) : (
        <Text style={themedStyles.label}>{label}</Text>
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
