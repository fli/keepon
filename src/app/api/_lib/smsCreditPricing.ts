export type SmsCreditPricing = Readonly<{
  creditCount: number
  price: string
  currency: string
}>

const smsCreditPricingTable = {
  AU: {
    creditCount: 100,
    price: '10.99',
    currency: 'AUD',
  },
  CA: {
    creditCount: 150,
    price: '9.99',
    currency: 'CAD',
  },
  US: {
    creditCount: 180,
    price: '8.99',
    currency: 'USD',
  },
  GB: {
    creditCount: 140,
    price: '5.99',
    currency: 'GBP',
  },
  NZ: {
    creditCount: 50,
    price: '11.99',
    currency: 'NZD',
  },
  IE: {
    creditCount: 90,
    price: '7.99',
    currency: 'EUR',
  },
  DE: {
    creditCount: 70,
    price: '7.99',
    currency: 'EUR',
  },
  LU: {
    creditCount: 70,
    price: '7.99',
    currency: 'EUR',
  },
  NL: {
    creditCount: 60,
    price: '7.99',
    currency: 'EUR',
  },
  SG: {
    creditCount: 150,
    price: '11.98',
    currency: 'SGD',
  },
  CH: {
    creditCount: 130,
    price: '11.90',
    currency: 'CHF',
  },
  NO: {
    creditCount: 110,
    price: '89',
    currency: 'NOK',
  },
  DK: {
    creditCount: 150,
    price: '49',
    currency: 'DKK',
  },
  SE: {
    creditCount: 70,
    price: '89',
    currency: 'SEK',
  },
} as const satisfies Record<string, SmsCreditPricing>

export type SmsCreditPricingCountryCode =
  keyof typeof smsCreditPricingTable

export const getSmsCreditPricingForCountry = (
  countryCode: string
): SmsCreditPricing | undefined => {
  const normalized = countryCode.trim().toUpperCase()
  return smsCreditPricingTable[
    normalized as SmsCreditPricingCountryCode
  ]
}

export const supportedSmsCreditPricingCountries = Object.freeze(
  Object.keys(smsCreditPricingTable)
) as readonly SmsCreditPricingCountryCode[]
