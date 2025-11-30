import { redirect } from 'next/navigation'

export default function NotificationsPage() {
  // This route exists for legacy links; send users to the dashboard notifications view.
  redirect('/dashboard/notifications')
}
