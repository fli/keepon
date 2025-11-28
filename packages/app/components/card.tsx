import { View, ViewProps, StyleSheet } from 'react-native'
import { useTheme } from 'app/theme'

type Props = ViewProps & {
  padded?: boolean
}

export function Card({ style, children, padded = true, ...rest }: Props) {
  const { theme } = useTheme()
  return (
    <View
      style={[
        styles(theme).base,
        padded && styles(theme).padded,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  )
}

const styles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    base: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    padded: {
      padding: theme.spacing.md,
    },
  })
