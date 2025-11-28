import { createContext, useContext } from 'react'

type ScreenProps = Record<string, unknown>

const ScreenPropsContext = createContext<ScreenProps>({})

export function ScreenPropsProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: ScreenProps
}) {
  return <ScreenPropsContext.Provider value={value}>{children}</ScreenPropsContext.Provider>
}

export function useScreenProps<T extends ScreenProps = ScreenProps>() {
  return useContext(ScreenPropsContext) as T
}
