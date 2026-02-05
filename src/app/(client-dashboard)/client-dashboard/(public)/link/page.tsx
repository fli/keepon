import { LinkClient } from './link-client'

type SearchParams = Record<string, string | string[] | undefined>

export default async function LinkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const redirectTo = typeof params.next === 'string' ? params.next : null

  return <LinkClient redirectTo={redirectTo} />
}
