import { forwardRef } from 'react'
import { TextInput, TextInputProps, Text, View, StyleSheet } from 'react-native'
import { useTheme } from 'app/theme'

type Props = TextInputProps & {
  label: string
  error?: string | null
}

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, error, style, ...rest },
  ref
) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={theme.colors.secondaryText}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
})

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    wrapper: {
      width: '100%',
      gap: theme.spacing.xs,
    },
    label: {
      fontWeight: '600',
      color: theme.colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radii.sm,
    },
    inputError: {
      borderColor: '#ef4444',
    },
    error: {
      color: '#ef4444',
      fontSize: 12,
    },
  })
