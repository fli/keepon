import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { readSessionFromCookies } from '../../session.server'
import { CreateAccountForm } from '../create-account-form'
import { PageContainer } from '@/components/page-container'
import { KeeponLogo } from '@/components/keepon-logo'
import { supportedCountryCodes, supportedCountries } from '@/lib/supportedCountries'

const DEFAULT_COUNTRY =
  supportedCountries.find(country => country.code === 'US')?.code ??
  supportedCountries[0]?.code ??
  'US'

const inferDefaultCountry = (reqHeaders: Headers) => {
  const ipCountry = reqHeaders.get('x-vercel-ip-country')?.trim().toUpperCase()
  if (ipCountry && supportedCountryCodes.has(ipCountry)) {
    return ipCountry
  }

  const acceptLanguage = reqHeaders.get('accept-language')
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim()
      if (!tag) continue

      const match = tag.match(/[-_]([A-Za-z]{2})$/)
      const code = match?.[1]?.toUpperCase()

      if (code && supportedCountryCodes.has(code)) {
        return code
      }
    }
  }

  return null
}

export default async function CreateAccountPage() {
  const session = await readSessionFromCookies()
  if (session) {
    redirect('/dashboard')
  }

  const headerList = await headers()
  const inferredCountry = inferDefaultCountry(headerList) ?? DEFAULT_COUNTRY

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-24 sm:py-32">
      <div className="flex w-full max-w-sm flex-col items-start gap-2 text-left">
        <KeeponLogo className="mb-4 h-8 w-auto" />
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Enter your details below to get started.</p>
      </div>
      <CreateAccountForm defaultCountry={inferredCountry} />
    </PageContainer>
  )
}
