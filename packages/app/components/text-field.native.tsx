import React from 'react'
import { VStack, TitleText, CaptionText, TextField as NativeTextField } from 'app/ui/native'

type Props = {
  label: string
  value?: string
  onChangeText?: (value: string) => void
  secureTextEntry?: boolean
  placeholder?: string
  error?: string | null
}

export function TextField({ label, error, ...rest }: Props) {
  return (
    <VStack spacing={4}>
      <TitleText size={15} color="white">
        {label}
      </TitleText>
      <NativeTextField {...rest} />
      {error ? <CaptionText color="#f87171">{error}</CaptionText> : null}
    </VStack>
  )
}
