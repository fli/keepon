import BigNumber from 'bignumber.js'

export type TransactionFeeType =
  | 'domestic'
  | 'international'
  | 'european'
  | 'nonEuropean'

export type TransactionFeeBreakdown = Readonly<{
  percentageFee: BigNumber
  fixedFee: BigNumber
  feeType: TransactionFeeType
}>

type FeeDefinitionInput = Readonly<{
  percentageFeePercent: string
  fixedFee: string
}>

type FeeTableEntry = Readonly<{
  domestic: FeeDefinitionInput
  international: FeeDefinitionInput
  currency: string
  domesticIsEuropean?: boolean
}>

const feeTable: Record<string, FeeTableEntry> = {
  AU: {
    domestic: { percentageFeePercent: '2.4', fixedFee: '0.4' },
    international: { percentageFeePercent: '3.9', fixedFee: '0.4' },
    currency: 'AUD',
  },
  CA: {
    domestic: { percentageFeePercent: '3.5', fixedFee: '0.4' },
    international: { percentageFeePercent: '4.5', fixedFee: '0.4' },
    currency: 'CAD',
  },
  US: {
    domestic: { percentageFeePercent: '3.5', fixedFee: '0.4' },
    international: { percentageFeePercent: '4.5', fixedFee: '0.4' },
    currency: 'USD',
  },
  GB: {
    domestic: { percentageFeePercent: '1.95', fixedFee: '0.3' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.3' },
    currency: 'GBP',
    domesticIsEuropean: true,
  },
  NZ: {
    domestic: { percentageFeePercent: '3.5', fixedFee: '0.4' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.4' },
    currency: 'NZD',
  },
  IE: {
    domestic: { percentageFeePercent: '1.95', fixedFee: '0.3' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.3' },
    currency: 'EUR',
    domesticIsEuropean: true,
  },
  DE: {
    domestic: { percentageFeePercent: '1.95', fixedFee: '0.3' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.3' },
    currency: 'EUR',
    domesticIsEuropean: true,
  },
  LU: {
    domestic: { percentageFeePercent: '1.95', fixedFee: '0.3' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.3' },
    currency: 'EUR',
    domesticIsEuropean: true,
  },
  NL: {
    domestic: { percentageFeePercent: '1.95', fixedFee: '0.3' },
    international: { percentageFeePercent: '3.5', fixedFee: '0.3' },
    currency: 'EUR',
    domesticIsEuropean: true,
  },
  SG: {
    domestic: { percentageFeePercent: '3.9', fixedFee: '0.5' },
    international: { percentageFeePercent: '3.9', fixedFee: '0.5' },
    currency: 'SGD',
  },
  CH: {
    domestic: { percentageFeePercent: '3.4', fixedFee: '0.35' },
    international: { percentageFeePercent: '3.4', fixedFee: '0.35' },
    currency: 'CHF',
  },
  NO: {
    domestic: { percentageFeePercent: '2.9', fixedFee: '2.3' },
    international: { percentageFeePercent: '3.4', fixedFee: '2.3' },
    currency: 'NOK',
  },
  DK: {
    domestic: { percentageFeePercent: '1.9', fixedFee: '1.9' },
    international: { percentageFeePercent: '3.5', fixedFee: '1.9' },
    currency: 'DKK',
    domesticIsEuropean: true,
  },
  SE: {
    domestic: { percentageFeePercent: '1.9', fixedFee: '1.9' },
    international: { percentageFeePercent: '3.5', fixedFee: '1.9' },
    currency: 'SEK',
    domesticIsEuropean: true,
  },
}

const europeanCountries = new Set([
  'AD',
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FO',
  'FI',
  'FR',
  'DE',
  'GI',
  'GR',
  'GL',
  'GG',
  'VA',
  'HU',
  'IS',
  'IE',
  'IM',
  'IL',
  'IT',
  'JE',
  'LV',
  'LI',
  'LT',
  'LU',
  'MK',
  'MT',
  'MC',
  'ME',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'PM',
  'SM',
  'RS',
  'SK',
  'SI',
  'ES',
  'SJ',
  'SE',
  'TR',
  'GB',
])

const toPercentage = (value: string) =>
  new BigNumber(value).shiftedBy(-2)

const toAmount = (value: string) => new BigNumber(value)

const buildFeeDefinition = (definition: FeeDefinitionInput) => ({
  percentageFee: toPercentage(definition.percentageFeePercent),
  fixedFee: toAmount(definition.fixedFee),
})

export const currencyChargeLimits = {
  USD: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  AUD: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  BRL: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  CAD: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  CHF: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  DKK: {
    minimumInSmallestUnit: 250,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  EUR: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  GBP: {
    minimumInSmallestUnit: 30,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  HKD: {
    minimumInSmallestUnit: 400,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  JPY: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 0,
  },
  MXN: {
    minimumInSmallestUnit: 1000,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  NOK: {
    minimumInSmallestUnit: 300,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  NZD: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  SEK: {
    minimumInSmallestUnit: 300,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
  SGD: {
    minimumInSmallestUnit: 50,
    maximumInSmallestUnit: 99999999,
    smallestUnitDecimals: 2,
  },
} as const

export class CurrencyNotSupportedError extends Error {
  constructor(currency: string) {
    super(`Currency ${currency} is not supported`)
    this.name = 'CurrencyNotSupportedError'
  }
}

export class CountryNotSupportedError extends Error {
  constructor(country: string) {
    super(`Country ${country} is not supported`)
    this.name = 'CountryNotSupportedError'
  }
}

export const getTransactionFee = (args: {
  cardCountry: string
  chargeCountry: string
  currency: string
}): TransactionFeeBreakdown => {
  const chargeCountry = args.chargeCountry.trim().toUpperCase()
  const cardCountry = args.cardCountry.trim().toUpperCase()
  const currency = args.currency.trim().toUpperCase()

  const config = feeTable[chargeCountry]
  if (!config) {
    throw new CountryNotSupportedError(chargeCountry)
  }

  if (currency !== config.currency) {
    throw new CurrencyNotSupportedError(currency)
  }

  const domestic = buildFeeDefinition(config.domestic)
  const international = buildFeeDefinition(config.international)

  if (config.domesticIsEuropean) {
    if (europeanCountries.has(cardCountry)) {
      return { ...domestic, feeType: 'european' }
    }
    return { ...international, feeType: 'nonEuropean' }
  }

  if (cardCountry === chargeCountry) {
    return { ...domestic, feeType: 'domestic' }
  }

  return { ...international, feeType: 'international' }
}
