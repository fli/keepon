import { AmexCardIcon } from './card-icons/AmexCardIcon'
import { DefaultCardIcon } from './card-icons/DefaultCardIcon'
import { DinersCardIcon } from './card-icons/DinersCardIcon'
import { DiscoverCardIcon } from './card-icons/DiscoverCardIcon'
import { JcbCardIcon } from './card-icons/JcbCardIcon'
import { MastercardCardIcon } from './card-icons/MastercardCardIcon'
import { UnionPayCardIcon } from './card-icons/UnionPayCardIcon'
import { VisaCardIcon } from './card-icons/VisaCardIcon'

export function CardIcon(props: React.SVGProps<SVGSVGElement> & { brand?: string }) {
  switch (props.brand?.toLowerCase()) {
    case 'amex':
      return AmexCardIcon(props)
    case 'diners':
      return DinersCardIcon(props)
    case 'discover':
      return DiscoverCardIcon(props)
    case 'jcb':
      return JcbCardIcon(props)
    case 'mastercard':
      return MastercardCardIcon(props)
    case 'unionpay':
      return UnionPayCardIcon(props)
    case 'visa':
      return VisaCardIcon(props)
    default:
      return DefaultCardIcon(props)
  }
}
