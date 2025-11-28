/* eslint-disable @typescript-eslint/no-explicit-any */
// override react-native types with react-native-web types
import 'react-native'

declare module 'react-native' {
  interface PressableStateCallbackType {
    hovered?: boolean
    focused?: boolean
  }
  interface ViewStyle {
    transitionProperty?: string
    transitionDuration?: string
  }
  interface TextProps {
    accessibilityComponentType?: never
    accessibilityTraits?: never
    href?: string
    hrefAttrs?: {
      rel: 'noreferrer'
      target?: '_blank'
    }
  }
  interface ViewProps {
    accessibilityRole?: string
    href?: string
    hrefAttrs?: {
      rel: 'noreferrer'
      target?: '_blank'
    }
    onClick?: (
      e: React.MouseEvent<HTMLAnchorElement | HTMLDivElement, MouseEvent>
    ) => void
  }

  // Surface a few React Native exports that are missing from the web type shims
  // or differ between native and web builds.
  // These are typed as `any` to avoid coupling web typings to native-specific values.
  const ActivityIndicator: any
  const Animated: any
  const Button: any
  const Platform: {
    OS: string
    select: <T>(spec: {
      ios?: T
      android?: T
      native?: T
      web?: T
      default?: T
    }) => T | undefined
  }
}
