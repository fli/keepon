export type SupportedCountryCurrency = Readonly<{
  countryId: number
  currencyId: number
}>

// Stripe Connect supported country -> currency mappings provided by user.
export const supportedCountryCurrency: readonly SupportedCountryCurrency[] = [
  { countryId: 36, currencyId: 36 }, // Australia -> AUD
  { countryId: 124, currencyId: 124 }, // Canada -> CAD
  { countryId: 208, currencyId: 208 }, // Denmark -> DKK
  { countryId: 276, currencyId: 978 }, // Germany -> EUR
  { countryId: 372, currencyId: 978 }, // Ireland -> EUR
  { countryId: 442, currencyId: 978 }, // Luxembourg -> EUR
  { countryId: 528, currencyId: 978 }, // Netherlands -> EUR
  { countryId: 554, currencyId: 554 }, // New Zealand -> NZD
  { countryId: 578, currencyId: 578 }, // Norway -> NOK
  { countryId: 702, currencyId: 702 }, // Singapore -> SGD
  { countryId: 752, currencyId: 752 }, // Sweden -> SEK
  { countryId: 756, currencyId: 756 }, // Switzerland -> CHF
  { countryId: 826, currencyId: 826 }, // United Kingdom -> GBP
  { countryId: 840, currencyId: 840 }, // United States -> USD
]
