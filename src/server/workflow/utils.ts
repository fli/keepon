import BigNumber from 'bignumber.js'
import crypto from 'node:crypto'

export const joinIgnoreEmpty = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' ')

export const currencyFormat = (
  amount: BigNumber | number,
  { locale, currency }: { locale: string; currency: string }
) => {
  const numeric = BigNumber.isBigNumber(amount) ? amount.toNumber() : amount
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(numeric)
}

export const md5 = (value: string) => crypto.createHash('md5').update(value).digest('hex')
