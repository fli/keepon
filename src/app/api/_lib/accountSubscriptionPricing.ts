export type AccountSubscriptionPricing = Readonly<{
  monthlyPrice: string
  yearlyPrice: string
  currency: string
}>

const accountSubscriptionPricingByCountry = {
  AU: {
    monthlyPrice: '29.99',
    yearlyPrice: '299.99',
    currency: 'AUD',
  },
  CA: {
    monthlyPrice: '24.99',
    yearlyPrice: '249.99',
    currency: 'CAD',
  },
  US: {
    monthlyPrice: '19.99',
    yearlyPrice: '199.99',
    currency: 'USD',
  },
  GB: {
    monthlyPrice: '17.99',
    yearlyPrice: '179.99',
    currency: 'GBP',
  },
  NZ: {
    monthlyPrice: '32.99',
    yearlyPrice: '329.99',
    currency: 'NZD',
  },
  IE: {
    monthlyPrice: '20.49',
    yearlyPrice: '204.99',
    currency: 'EUR',
  },
  DE: {
    monthlyPrice: '20.49',
    yearlyPrice: '204.99',
    currency: 'EUR',
  },
  LU: {
    monthlyPrice: '20.49',
    yearlyPrice: '204.99',
    currency: 'EUR',
  },
  NL: {
    monthlyPrice: '20.49',
    yearlyPrice: '204.99',
    currency: 'EUR',
  },
  SG: {
    monthlyPrice: '25.98',
    yearlyPrice: '258.98',
    currency: 'SGD',
  },
  CH: {
    monthlyPrice: '20',
    yearlyPrice: '200',
    currency: 'CHF',
  },
  NO: {
    monthlyPrice: '205.00',
    yearlyPrice: '2050.00',
    currency: 'NOK',
  },
  DK: {
    monthlyPrice: '159.00',
    yearlyPrice: '1599.00',
    currency: 'DKK',
  },
  SE: {
    monthlyPrice: '225.00',
    yearlyPrice: '2195.00',
    currency: 'SEK',
  },
} as const satisfies Record<
  string,
  AccountSubscriptionPricing
>

export type AccountSubscriptionCountryCode = keyof typeof accountSubscriptionPricingByCountry

export const getAccountSubscriptionPricingForCountry = (
  countryCode: string
): AccountSubscriptionPricing | undefined => {
  const normalized = countryCode.trim().toUpperCase()
  return accountSubscriptionPricingByCountry[
    normalized as AccountSubscriptionCountryCode
  ]
}

export const supportedAccountSubscriptionCountries = Object.freeze(
  Object.keys(accountSubscriptionPricingByCountry)
) as readonly AccountSubscriptionCountryCode[]
