import { KeyboardAvoidingView as RNKeyboardAvoidingView } from 'react-native-keyboard-controller'

export type KeyboardAvoidingViewProps = React.ComponentProps<typeof RNKeyboardAvoidingView>

export function KeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  return <RNKeyboardAvoidingView {...props} />
}
