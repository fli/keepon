import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const faqItems = [
  {
    question: 'What is this dashboard?',
    answer:
      'This is a central place where you can see upcoming payments, historical payments, and subscriptions for products or services you have purchased from your service provider. In the future this will also include booking information and more.',
  },
  {
    question: 'How do I pause a subscription or stop a payment?',
    answer:
      'Contact the service provider who created the recurring payment or request. If you are having trouble reaching them, email enquiry@getkeepon.com and we will reach out on your behalf.',
  },
  {
    question: 'What fees are applicable to me?',
    answer:
      'Keepon does not charge clients any fees. The amount listed in the payment request or subscription is exactly what you will be charged. If your provider chooses to pass on card processing fees, it will be displayed clearly on the payment page.',
  },
  {
    question: 'What information can be seen by the service provider?',
    answer:
      'Service providers can see whether payments are successful, pending, or declined. They cannot see sensitive card information. Payments are processed securely by Stripe, a PCI DSS compliant payment gateway.',
  },
  {
    question: 'Is my information secure and private?',
    answer: 'Yes. You can read more about how we handle data in our privacy policy.',
  },
  {
    question: 'Something is wrong, I need help.',
    answer: 'If you have questions or want to raise a dispute, reach out to enquiry@getkeepon.com and we will help.',
  },
]

export default function FaqPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-foreground">Help center</h1>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/client-dashboard" />}>
          Back to dashboard
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Frequently asked questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {faqItems.map((item, index) => (
            <div key={item.question} className={index === 0 ? '' : 'border-t border-border/60 pt-6'}>
              <h2 className="text-sm font-semibold text-foreground">{item.question}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.answer.includes('enquiry@getkeepon.com') ? (
                  <>
                    {item.answer.split('enquiry@getkeepon.com')[0]}
                    <a className="underline" href="mailto:enquiry@getkeepon.com">
                      enquiry@getkeepon.com
                    </a>
                    {item.answer.split('enquiry@getkeepon.com')[1]}
                  </>
                ) : (
                  item.answer
                )}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
