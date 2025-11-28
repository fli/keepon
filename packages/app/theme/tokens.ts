// Shared design tokens for Keepon.
// Light/dark palettes stay aligned with the previous SwiftUI-derived colors.

const swiftUIColors = {
  light: {
    // Text
    label: '#000000',
    secondaryLabel: 'rgba(60, 60, 67, 0.6)',
    tertiaryLabel: 'rgba(60, 60, 67, 0.3)',
    quaternaryLabel: 'rgba(60, 60, 67, 0.18)',
    placeholderText: 'rgba(60, 60, 67, 0.3)',

    // Separators
    separator: 'rgba(60, 60, 67, 0.29)',
    opaqueSeparator: '#c6c6c8',

    // Backgrounds
    systemBackground: '#ffffff',
    secondarySystemBackground: '#f2f2f7',
    tertiarySystemBackground: '#ffffff',
    systemGroupedBackground: '#f2f2f7',
    secondarySystemGroupedBackground: '#ffffff',
    tertiarySystemGroupedBackground: '#f2f2f7',

    // Fills
    systemFill: 'rgba(120, 120, 128, 0.20)',
    secondarySystemFill: 'rgba(120, 120, 128, 0.16)',
    tertiarySystemFill: 'rgba(118, 118, 128, 0.12)',
    quaternarySystemFill: 'rgba(116, 116, 128, 0.08)',

    // Accents
    link: '#007aff',
    systemBlue: '#007aff',
    systemGreen: '#34c759',
    systemIndigo: '#5856d6',
    systemOrange: '#ff9500',
    systemPink: '#ff2d55',
    systemPurple: '#af52de',
    systemRed: '#ff3b30',
    systemTeal: '#5ac8fa',
    systemYellow: '#ffcc00',
    systemBrown: '#a2845e',
    systemMint: '#00c7be',
    systemCyan: '#32ade6',

    // Grays
    systemGray: '#8e8e93',
    systemGray2: '#aeaeb2',
    systemGray3: '#c7c7cc',
    systemGray4: '#d1d1d6',
    systemGray5: '#e5e5ea',
    systemGray6: '#f2f2f7',
  },
  dark: {
    // Text
    label: '#ffffff',
    secondaryLabel: 'rgba(235, 235, 245, 0.6)',
    tertiaryLabel: 'rgba(235, 235, 245, 0.3)',
    quaternaryLabel: 'rgba(235, 235, 245, 0.18)',
    placeholderText: 'rgba(235, 235, 245, 0.3)',

    // Separators
    separator: 'rgba(84, 84, 88, 0.6)',
    opaqueSeparator: '#38383a',

    // Backgrounds
    systemBackground: '#000000',
    secondarySystemBackground: '#1c1c1e',
    tertiarySystemBackground: '#2c2c2e',
    systemGroupedBackground: '#000000',
    secondarySystemGroupedBackground: '#1c1c1e',
    tertiarySystemGroupedBackground: '#2c2c2e',

    // Fills
    systemFill: 'rgba(120, 120, 128, 0.36)',
    secondarySystemFill: 'rgba(120, 120, 128, 0.32)',
    tertiarySystemFill: 'rgba(118, 118, 128, 0.24)',
    quaternarySystemFill: 'rgba(118, 118, 128, 0.18)',

    // Accents
    link: '#0a84ff',
    systemBlue: '#0a84ff',
    systemGreen: '#30d158',
    systemIndigo: '#5e5ce6',
    systemOrange: '#ff9f0a',
    systemPink: '#ff375f',
    systemPurple: '#bf5af2',
    systemRed: '#ff453a',
    systemTeal: '#64d2ff',
    systemYellow: '#ffd60a',
    systemBrown: '#ab8f69',
    systemMint: '#63e6e2',
    systemCyan: '#64d2ff',

    // Grays
    systemGray: '#8e8e93',
    systemGray2: '#636366',
    systemGray3: '#48484a',
    systemGray4: '#3a3a3c',
    systemGray5: '#2c2c2e',
    systemGray6: '#1c1c1e',
  },
} as const

export type Theme = {
  colors: Record<string, string>
  spacing: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
  }
  radii: {
    sm: number
    md: number
    lg: number
  }
  typography: {
    h1: number
    body: number
  }
}

export const lightTheme: Theme = {
  colors: {
    background: swiftUIColors.light.systemBackground,
    surface: swiftUIColors.light.secondarySystemBackground,
    text: swiftUIColors.light.label,
    secondaryText: swiftUIColors.light.secondaryLabel,
    border: swiftUIColors.light.separator,
    ...swiftUIColors.light,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radii: {
    sm: 8,
    md: 12,
    lg: 20,
  },
  typography: {
    h1: 28,
    body: 16,
  },
}

export const darkTheme: Theme = {
  colors: {
    background: swiftUIColors.dark.systemBackground,
    surface: swiftUIColors.dark.secondarySystemBackground,
    text: swiftUIColors.dark.label,
    secondaryText: swiftUIColors.dark.secondaryLabel,
    border: swiftUIColors.dark.separator,
    ...swiftUIColors.dark,
  },
  spacing: lightTheme.spacing,
  radii: lightTheme.radii,
  typography: lightTheme.typography,
}

export const designTokens = {
  light: lightTheme,
  dark: darkTheme,
} as const

export type ThemeName = keyof typeof designTokens
export const defaultThemeName: ThemeName = 'light'

export function getTheme(name: ThemeName = defaultThemeName): Theme {
  return designTokens[name]
}

export function themeToCssVariables(theme: Theme) {
  const entries: Record<string, string> = {}
  Object.entries(theme.colors).forEach(([key, value]) => {
    entries[`--color-${key}`] = value
  })
  Object.entries(theme.spacing).forEach(([key, value]) => {
    entries[`--space-${key}`] = `${value}px`
  })
  Object.entries(theme.radii).forEach(([key, value]) => {
    entries[`--radius-${key}`] = `${value}px`
  })
  Object.entries(theme.typography).forEach(([key, value]) => {
    entries[`--font-${key}`] = `${value}px`
  })
  return entries
}
