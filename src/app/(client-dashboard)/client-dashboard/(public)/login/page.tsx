import { LoginClient } from './login-client'

type SearchParams = Record<string, string | string[] | undefined>

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const redirectTo = typeof params.next === 'string' ? params.next : null
  const initialEmail = typeof params.email === 'string' ? params.email : ''

  return <LoginClient redirectTo={redirectTo} initialEmail={initialEmail} />
}
