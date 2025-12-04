import { countries } from '@/config/countries'
import { supportedCountryCurrency } from '@/config/supportedCountryCurrency'

export type SupportedCountry = Readonly<{
  code: string
  name: string
  flag: string
}>

const FLAG_BASE_CODE_POINT = 0x1f1e6
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  GB: 'United Kingdom',
  US: 'United States',
}

const countriesById = new Map(countries.map((country) => [country.id, country]))

const toFlagEmoji = (alpha2: string) => {
  if (alpha2.length !== 2) return alpha2

  const upper = alpha2.toUpperCase()
  const first = upper.charCodeAt(0) - 65
  const second = upper.charCodeAt(1) - 65

  if (first < 0 || second < 0) return upper

  return String.fromCodePoint(FLAG_BASE_CODE_POINT + first, FLAG_BASE_CODE_POINT + second)
}

export const supportedCountries: ReadonlyArray<SupportedCountry> = supportedCountryCurrency
  .map((mapping) => {
    const country = countriesById.get(mapping.countryId)
    if (!country) return null

    const code = country.alpha2
    const name = DISPLAY_NAME_OVERRIDES[code] ?? country.name

    return {
      code,
      name,
      flag: toFlagEmoji(code),
    }
  })
  .filter((country): country is SupportedCountry => Boolean(country))
  .sort((a, b) => a.name.localeCompare(b.name))

export const supportedCountryCodes = new Set(supportedCountries.map((country) => country.code))
