import BigNumber from 'bignumber.js'
import { currencyChargeLimits } from '@/app/api/_lib/transactionFees'

export class CountryNotSupportedError extends Error {
  constructor() {
    super('Country not supported')
    this.name = 'CountryNotSupportedError'
  }
}

export class CurrencyNotSupportedError extends Error {
  constructor() {
    super('Currency not supported')
    this.name = 'CurrencyNotSupportedError'
  }
}

/**
 * From https://stripe.com/docs/currencies#european-credit-cards
 */
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

export const supportedCountries = [
  'AU',
  'CA',
  'US',
  'GB',
  'NZ',
  'IE',
  'DE',
  'LU',
  'NL',
  'SG',
  'CH',
  'NO',
  'DK',
  'SE',
] as const

export type SupportedCountries = (typeof supportedCountries)[number]

type FeeTableEntry = {
  domestic: {
    percentageFee: BigNumber
    fixedFee: BigNumber
    stripeFixedFee: BigNumber
    stripePercentageFee: BigNumber
  }
  international: {
    percentageFee: BigNumber
    fixedFee: BigNumber
    stripeFixedFee: BigNumber
    stripePercentageFee: BigNumber
  }
  currency: string
  domesticIsEuropean?: boolean
  smsCreditPricing: {
    creditCount: number
    price: BigNumber
  }
  accountSubscriptionPricing: {
    monthlyPrice: BigNumber
    yearlyPrice: BigNumber
  }
}

export const fees: Record<SupportedCountries, FeeTableEntry> = {
  AU: {
    domestic: {
      percentageFee: new BigNumber('2.4').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('1.75').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.9').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    currency: 'AUD',
    smsCreditPricing: {
      creditCount: 100,
      price: new BigNumber('10.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('29.99'),
      yearlyPrice: new BigNumber('299.99'),
    },
  },
  CA: {
    domestic: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('4.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('3.5').shiftedBy(-2),
    },
    currency: 'CAD',
    smsCreditPricing: {
      creditCount: 150,
      price: new BigNumber('9.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('24.99'),
      yearlyPrice: new BigNumber('249.99'),
    },
  },
  US: {
    domestic: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('4.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('3.9').shiftedBy(-2),
    },
    currency: 'USD',
    smsCreditPricing: {
      creditCount: 180,
      price: new BigNumber('8.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('19.99'),
      yearlyPrice: new BigNumber('199.99'),
    },
  },
  GB: {
    domestic: {
      percentageFee: new BigNumber('1.95').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.2'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.2'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    currency: 'GBP',
    domesticIsEuropean: true,
    smsCreditPricing: {
      creditCount: 140,
      price: new BigNumber('5.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('17.99'),
      yearlyPrice: new BigNumber('179.99'),
    },
  },
  NZ: {
    domestic: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.4'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    currency: 'NZD',
    smsCreditPricing: {
      creditCount: 50,
      price: new BigNumber('11.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('32.99'),
      yearlyPrice: new BigNumber('329.99'),
    },
  },
  IE: {
    domestic: {
      percentageFee: new BigNumber('1.95').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'EUR',
    smsCreditPricing: {
      creditCount: 90,
      price: new BigNumber('7.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('20.49'),
      yearlyPrice: new BigNumber('204.99'),
    },
  },
  DE: {
    domestic: {
      percentageFee: new BigNumber('1.95').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'EUR',
    smsCreditPricing: {
      creditCount: 70,
      price: new BigNumber('7.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('20.49'),
      yearlyPrice: new BigNumber('204.99'),
    },
  },
  LU: {
    domestic: {
      percentageFee: new BigNumber('1.95').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'EUR',
    smsCreditPricing: {
      creditCount: 70,
      price: new BigNumber('7.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('20.49'),
      yearlyPrice: new BigNumber('204.99'),
    },
  },
  NL: {
    domestic: {
      percentageFee: new BigNumber('1.95').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('.3'),
      stripeFixedFee: new BigNumber('.25'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'EUR',
    smsCreditPricing: {
      creditCount: 60,
      price: new BigNumber('7.99'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('20.49'),
      yearlyPrice: new BigNumber('204.99'),
    },
  },
  SG: {
    domestic: {
      percentageFee: new BigNumber('3.9').shiftedBy(-2),
      fixedFee: new BigNumber('.5'),
      stripeFixedFee: new BigNumber('.5'),
      stripePercentageFee: new BigNumber('3.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.9').shiftedBy(-2),
      fixedFee: new BigNumber('.5'),
      stripeFixedFee: new BigNumber('.5'),
      stripePercentageFee: new BigNumber('3.4').shiftedBy(-2),
    },
    currency: 'SGD',
    smsCreditPricing: {
      creditCount: 150,
      price: new BigNumber('11.98'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('25.98'),
      yearlyPrice: new BigNumber('258.98'),
    },
  },
  CH: {
    domestic: {
      percentageFee: new BigNumber('3.4').shiftedBy(-2),
      fixedFee: new BigNumber('.35'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.4').shiftedBy(-2),
      fixedFee: new BigNumber('.35'),
      stripeFixedFee: new BigNumber('.3'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    currency: 'CHF',
    smsCreditPricing: {
      creditCount: 130,
      price: new BigNumber('11.90'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('20'),
      yearlyPrice: new BigNumber('200'),
    },
  },
  NO: {
    domestic: {
      percentageFee: new BigNumber('2.9').shiftedBy(-2),
      fixedFee: new BigNumber('2.3'),
      stripeFixedFee: new BigNumber('2'),
      stripePercentageFee: new BigNumber('2.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.4').shiftedBy(-2),
      fixedFee: new BigNumber('2.3'),
      stripeFixedFee: new BigNumber('2'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    currency: 'NOK',
    smsCreditPricing: {
      creditCount: 110,
      price: new BigNumber('89'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('205.00'),
      yearlyPrice: new BigNumber('2050.00'),
    },
  },
  DK: {
    domestic: {
      percentageFee: new BigNumber('1.9').shiftedBy(-2),
      fixedFee: new BigNumber('1.9'),
      stripeFixedFee: new BigNumber('1.8'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('1.9'),
      stripeFixedFee: new BigNumber('1.8'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'DKK',
    smsCreditPricing: {
      creditCount: 150,
      price: new BigNumber('49'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('159.00'),
      yearlyPrice: new BigNumber('1599.00'),
    },
  },
  SE: {
    domestic: {
      percentageFee: new BigNumber('1.9').shiftedBy(-2),
      fixedFee: new BigNumber('1.9'),
      stripeFixedFee: new BigNumber('1.8'),
      stripePercentageFee: new BigNumber('1.4').shiftedBy(-2),
    },
    international: {
      percentageFee: new BigNumber('3.5').shiftedBy(-2),
      fixedFee: new BigNumber('1.9'),
      stripeFixedFee: new BigNumber('1.8'),
      stripePercentageFee: new BigNumber('2.9').shiftedBy(-2),
    },
    domesticIsEuropean: true,
    currency: 'SEK',
    smsCreditPricing: {
      creditCount: 70,
      price: new BigNumber('89'),
    },
    accountSubscriptionPricing: {
      monthlyPrice: new BigNumber('225.00'),
      yearlyPrice: new BigNumber('2195.00'),
    },
  },
}

export const getFee: (args: { cardCountry: string; chargeCountry: string; currency: string }) => {
  fixedFee: BigNumber
  percentageFee: BigNumber
  stripeFixedFee: BigNumber
  stripePercentageFee: BigNumber
  feeType: 'domestic' | 'international' | 'european' | 'nonEuropean'
} = (args) => {
  const chargeCountry = args.chargeCountry.toUpperCase()
  const cardCountry = args.cardCountry.toUpperCase()
  const currency = args.currency.toUpperCase()
  if (!(chargeCountry in fees)) {
    throw new CountryNotSupportedError()
  }
  const data = fees[chargeCountry as keyof typeof fees]
  if (currency !== data.currency) {
    throw new CurrencyNotSupportedError()
  }
  if ('domesticIsEuropean' in data && data.domesticIsEuropean) {
    if (europeanCountries.has(cardCountry)) {
      return { ...data.domestic, feeType: 'european' }
    } else {
      return { ...data.international, feeType: 'nonEuropean' }
    }
  } else if (cardCountry === chargeCountry) {
    return { ...data.domestic, feeType: 'domestic' }
  } else {
    return { ...data.international, feeType: 'international' }
  }
}

const getCurrencyLimits = (currency: string) => {
  return currencyChargeLimits[currency.toUpperCase() as keyof typeof currencyChargeLimits]
}

export const calculateFee: (args: {
  cardCountry: string
  chargeCountry: string
  currency: string
  amount: BigNumber
}) => BigNumber = ({ cardCountry, chargeCountry, currency, amount }) => {
  const { percentageFee, fixedFee } = getFee({
    cardCountry,
    chargeCountry,
    currency,
  })
  return amount.times(percentageFee).plus(fixedFee).decimalPlaces(getCurrencyLimits(currency).smallestUnitDecimals)
}

export const calculateStripeFee: (args: {
  cardCountry: string
  chargeCountry: string
  currency: string
  amount: BigNumber
}) => BigNumber = ({ cardCountry, chargeCountry, currency, amount }) => {
  const { stripePercentageFee: percentageFee, stripeFixedFee: fixedFee } = getFee({
    cardCountry,
    chargeCountry,
    currency,
  })
  return amount.times(percentageFee).plus(fixedFee).decimalPlaces(getCurrencyLimits(currency).smallestUnitDecimals)
}
