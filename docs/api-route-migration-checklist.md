# API Route Migration Checklist

Generated on 2025-10-28 from ../keepon-full/api-server/src/routes.

Security values reflect middleware expectations from the legacy server (`null` means no token check).

## Access Token (accessToken)

- [x] `GET` `/accessToken` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/access-token.get.ts)_

## Account Subscription (accountSubscription)

- [x] `PATCH` `/accountSubscription` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/account-subscription.patch.ts)_
- [x] `PUT` `/accountSubscription` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/account-subscription.put.ts)_
- [x] `POST` `/accountSubscription/billingPortalSessions` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/account-subscription.billing-portal-sessions.post.ts)_

## Account Subscription Plan (accountSubscriptionPlan)

- [x] `GET` `/accountSubscriptionPlan` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/account-subscription-plan.get.ts)_

## Apple Search Ads Attribution (appleSearchAdsAttribution)

- [x] `POST` `/appleSearchAdsAttribution` — security: none _(source: ../keepon-full/api-server/src/routes/apple-search-ads-attribution.post.ts)_

## App Store Receipts (appStoreReceipts)

- [x] `POST` `/appStoreReceipts` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/app-store-receipts.post.ts)_

## App Store Server Notifications (appStoreServerNotifications)

- [x] `POST` `/appStoreServerNotifications` — security: none _(source: ../keepon-full/api-server/src/routes/app-store-server-notifications.post.ts)_

## Bookings (bookings)

- [x] `POST` `/bookings` — security: none _(source: ../keepon-full/api-server/src/routes/bookings.post.ts)_

## Buckets (buckets)

- [x] `GET` `/buckets/ptbizapp-images/download/:imageUrl` — security: none _(source: ../keepon-full/api-server/src/routes/buckets.ptbizapp-images.download.[imageUrl].get.ts)_
- [x] `POST` `/buckets/ptbizapp-images/upload` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/buckets.ptbizapp-images.upload.post.ts)_

## Busy Times (busyTimes)

- [x] `GET` `/busyTimes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/busy-times.get.ts)_
- [x] `PUT` `/busyTimes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/busy-times.put.ts)_

## Charts (charts)

- [x] `GET` `/charts/revenue` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/charts.revenue.get.ts)_

## Client (client)

- [x] `GET` `/client` — security: `client` _(source: ../keepon-full/api-server/src/routes/client.get.ts)_

## Client Logins (client-logins)

- [x] `GET` `/client-logins` — security: none _(source: ../keepon-full/api-server/src/routes/client-logins.get.ts)_

## Client Dashboard Tokens (clientDashboardTokens)

- [x] `POST` `/clientDashboardTokens` — security: none _(source: ../keepon-full/api-server/src/routes/client-dashboard-tokens.post.ts)_

## Client Login Requests (clientLoginRequests)

- [x] `POST` `/clientLoginRequests` — security: none _(source: ../keepon-full/api-server/src/routes/client-login-requests.post.ts)_

## Client Notes (clientNotes)

- [x] `GET` `/clientNotes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-notes.get.ts)_
- [x] `POST` `/clientNotes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-notes.post.ts)_
- [x] `DELETE` `/clientNotes/:clientNoteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-notes.[clientNoteId].delete.ts)_
- [x] `GET` `/clientNotes/:clientNoteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-notes.[clientNoteId].get.ts)_
- [x] `PATCH` `/clientNotes/:clientNoteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-notes.[clientNoteId].patch.ts)_

## Clients (clients)

- [x] `GET` `/clients` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.get.ts)_
- [x] `DELETE` `/clients/:clientId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].delete.ts)_
- [x] `GET` `/clients/:clientId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].get.ts)_
- [x] `PUT` `/clients/:clientId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].put.ts)_
- [x] `PUT` `/clients/:clientId/dashboardLink` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].dashboardLink.put.ts)_
- [x] `POST` `/clients/:clientId/notes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].notes.post.ts)_
- [x] `PUT` `/clients/:clientId/notes/:noteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].notes.[noteId].put.ts)_
- [x] `POST` `/clients/:clientId/plans` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.post.ts)_
- [x] `PUT` `/clients/:clientId/plans/:planId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].put.ts)_
- [x] `POST` `/clients/:clientId/plans/:planId/cancel` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].cancel.post.ts)_
- [x] `PUT` `/clients/:clientId/plans/:planId/pause` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].pause.put.ts)_
- [x] `DELETE` `/clients/:clientId/plans/:planId/sessionSeries/:sessionSeriesId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].sessionSeries.[sessionSeriesId].delete.ts)_
- [x] `PUT` `/clients/:clientId/plans/:planId/sessionSeries/:sessionSeriesId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].sessionSeries.[sessionSeriesId].put.ts)_
- [x] `PUT` `/clients/:clientId/plans/:planId/unpause` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].plans.[planId].unpause.put.ts)_
- [x] `PUT` `/clients/:clientId/termsAccepted` — security: `client` _(source: ../keepon-full/api-server/src/routes/clients.[clientId].termsAccepted.put.ts)_
- [x] `GET` `/clients/members` — security: none _(source: ../keepon-full/api-server/src/routes/clients.[[members.get.ts)_

## Client Sessions (clientSessions)

- [x] `GET` `/clientSessions` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.get.ts)_
- [x] `GET` `/clientSessions/:clientSessionId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].get.ts)_
- [x] `PUT` `/clientSessions/:clientSessionId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].put.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/cancel` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].cancel.post.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/confirm` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].confirm.post.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/invite` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].invite.post.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/maybe` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].maybe.post.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/notes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].notes.post.ts)_
- [x] `PUT` `/clientSessions/:clientSessionId/notes/:noteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].notes.[noteId].put.ts)_
- [x] `POST` `/clientSessions/:clientSessionId/share` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.[clientSessionId].share.post.ts)_
- [x] `POST` `/clientSessions/invite` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/client-sessions.invite.post.ts)_

## Config (config)

- [x] `GET` `/config` — security: none _(source: ../keepon-full/api-server/src/routes/config.get.ts)_

## Events (events)

- [x] `GET` `/events` — security: none _(source: ../keepon-full/api-server/src/routes/events.get.ts)_

## Finance Items (financeItems)

- [x] `DELETE` `/financeItems/:financeItemId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItem].delete.ts)_
- [x] `GET` `/financeItems/:financeItemId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItemId].get.ts)_
- [x] `PUT` `/financeItems/:financeItemId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItemId].put.ts)_
- [x] `POST` `/financeItems/:financeItemId/notes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItemId].notes.post.ts)_
- [x] `PUT` `/financeItems/:financeItemId/notes/:noteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItemId].notes.[noteId].put.ts)_
- [x] `POST` `/financeItems/:financeItemId/upload` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/finance-items.[financeItemId].upload.post.ts)_

## Geolocation (geolocation)

- [x] `GET` `/geolocation` — security: none _(source: ../keepon-full/api-server/src/routes/geolocation.get.ts)_

## Google (google)

- [x] `GET` `/google/place/autocomplete` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/google.place.autocomplete.get.ts)_

## Icalendar (icalendar)

- [x] `GET` `/icalendar/:id` — security: none _(source: ../keepon-full/api-server/src/routes/icalendar.[id].get.ts)_

## Ics (ics)

- [x] `GET` `/ics` — security: none _(source: ../keepon-full/api-server/src/routes/ics.get.ts)_

## Lytics (lytics)

- [x] `POST` `/lytics/batch` — security: none _(source: ../keepon-full/api-server/src/routes/lytics.batch.post.ts)_

## Mandrill Events (mandrillEvents)

- [x] `POST` `/mandrillEvents` — security: none _(source: ../keepon-full/api-server/src/routes/mandrill-events.post.ts)_

## Members (members)

- [x] `POST` `/members/:memberId/devices` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/members.[memberId].devices.post.ts)_
- [x] `GET` `/members/:userId` — security: none _(source: ../keepon-full/api-server/src/routes/members.[userId].get.ts)_
- [x] `POST` `/members/:userId/password` — security: none _(source: ../keepon-full/api-server/src/routes/members.[userId].password.post.ts)_
- [x] `POST` `/members/login` — security: none _(source: ../keepon-full/api-server/src/routes/members.login.post.ts)_
- [x] `POST` `/members/logout` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/members.logout.post.ts)_
- [x] `POST` `/members/password` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/members.password.post.ts)_
- [x] `POST` `/members/reset` — security: none _(source: ../keepon-full/api-server/src/routes/members.reset.post.ts)_

## Missions (missions)

- [x] `GET` `/missions` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/missions.get.ts)_

## Online Bookings (onlineBookings)

- [x] `GET` `/onlineBookings/bookings/:bookingId` — security: none _(source: ../keepon-full/api-server/src/routes/online-bookings.bookings.[bookingId].get.ts)_
- [x] `POST` `/onlineBookings/bookings/:bookingId/cancel` — security: none _(source: ../keepon-full/api-server/src/routes/online-bookings.bookings.[bookingId].cancel.post.ts)_
- [x] `GET` `/onlineBookings/providers/:pageUrlSlug` — security: none _(source: ../keepon-full/api-server/src/routes/online-bookings.providers.[pageUrlSlug].get.ts)_
- [x] `GET` `/onlineBookings/settings` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/online-bookings.settings.get.ts)_
- [x] `PATCH` `/onlineBookings/settings` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/online-bookings.settings.patch.ts)_

## Payment Plan Payments (paymentPlanPayments)

- [x] `GET` `/paymentPlanPayments` — security: `client` _(source: ../keepon-full/api-server/src/routes/payment-plan-payments.get.ts)_

## Payment Plans (paymentPlans)

- [x] `GET` `/paymentPlans` — security: `client` _(source: ../keepon-full/api-server/src/routes/payment-plans.get.ts)_
- [x] `GET` `/paymentPlans/:paymentPlanId` — security: `client` _(source: ../keepon-full/api-server/src/routes/payment-plans.[paymentPlanId].get.ts)_

## Payouts (payouts)

- [x] `GET` `/payouts` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/payouts.get.ts)_

## Plan Payments (planPayments)

- [x] `PUT` `/planPayments/:paymentPlanPaymentId/refund` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/plan-payments.[paymentPlanPaymentId].refund.put.ts)_

## Plans (plans)

- [x] `GET` `/plans` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/plans.get.ts)_
- [x] `GET` `/plans/:planId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/plans.[planId].get.ts)_
- [x] `PUT` `/plans/:planId/accept` — security: `client` _(source: ../keepon-full/api-server/src/routes/plans.[planId].accept.put.ts)_
- [x] `PUT` `/plans/:planId/retry` — security: `client` _(source: ../keepon-full/api-server/src/routes/plans.[planId].retry.put.ts)_

## Products (products)

- [x] `GET` `/products` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.get.ts)_
- [x] `POST` `/products` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.post.ts)_
- [x] `DELETE` `/products/:productId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.[productId].delete.ts)_
- [x] `GET` `/products/:productId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.[productId].get.ts)_
- [x] `PATCH` `/products/:productId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.[productId].patch.ts)_
- [x] `POST` `/products/:productId/upload` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/products.[productId].upload.ts)_

## Recent Locations (recentLocations)

- [x] `GET` `/recentLocations` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/recent-locations.get.ts)_

## Rewards (rewards)

- [x] `GET` `/rewards` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/rewards.get.ts)_
- [x] `PATCH` `/rewards/:rewardId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/rewards.[rewardId].patch.ts)_

## Sale Payments (salePayments)

- [x] `GET` `/salePayments` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sale-payments.get.ts)_
- [x] `POST` `/salePayments` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sale-payments.post.ts)_
- [x] `DELETE` `/salePayments/:paymentId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-payments.[paymentId].delete.ts)_
- [x] `GET` `/salePayments/:paymentId` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sale-payments.[paymentId].get.ts)_
- [x] `PATCH` `/salePayments/:paymentId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-payments.[paymentId].patch.ts)_
- [x] `POST` `/salePayments/:paymentId/refund` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-payments.[paymentId].refund.post.ts)_

## Sale Products (saleProducts)

- [x] `GET` `/saleProducts` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sale-products.get.ts)_
- [x] `POST` `/saleProducts` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-products.post.ts)_
- [x] `DELETE` `/saleProducts/:saleProductId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-products.[saleProductId].delete.ts)_
- [x] `GET` `/saleProducts/:saleProductId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-products.[saleProductId].get.ts)_
- [x] `PATCH` `/saleProducts/:saleProductId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sale-products.[saleProductId].patch.ts)_

## Sales (sales)

- [x] `GET` `/sales` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sales.get.ts)_
- [x] `POST` `/sales` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sales.post.ts)_
- [x] `DELETE` `/sales/:saleId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sales.[saleId].delete.ts)_
- [x] `GET` `/sales/:saleId` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/sales.[saleId].get.ts)_
- [x] `PATCH` `/sales/:saleId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sales.[saleId].patch.ts)_
- [x] `DELETE` `/sales/:saleId/paymentRequest` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sales.[saleId].payment-request.delete.ts)_
- [x] `POST` `/sales/:saleId/paymentRequest` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sales.[saleId].payment-request.post.ts)_

## Service Provider (serviceProvider)

- [x] `GET` `/serviceProvider` — security: `client` _(source: ../keepon-full/api-server/src/routes/service-provider.get.ts)_

## Session Invitation Links (sessionInvitationLinks)

- [x] `GET` `/sessionInvitationLinks/:invitationId` — security: none _(source: ../keepon-full/api-server/src/routes/session-invitation-links.[invitationId].get.ts)_

## Session Invitations (sessionInvitations)

- [x] `POST` `/sessionInvitations` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-invitations.post.ts)_
- [x] `DELETE` `/sessionInvitations/:id` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-invitations.[id].delete.ts)_

## Sessions (sessions)

- [x] `GET` `/sessions` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.get.ts)_
- [x] `DELETE` `/sessions/:sessionId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].delete.ts)_
- [x] `GET` `/sessions/:sessionId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].get.ts)_
- [x] `PUT` `/sessions/:sessionId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].put.ts)_
- [x] `POST` `/sessions/:sessionId/clients` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].clients.post.ts)_
- [x] `DELETE` `/sessions/:sessionId/clients/:clientId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].clients.[clientId].delete.ts)_
- [x] `POST` `/sessions/:sessionId/notes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].notes.post.ts)_
- [x] `PUT` `/sessions/:sessionId/notes/:noteId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessions.[sessionId].notes.[noteId].put.ts)_

## Session Series (sessionSeries)

- [x] `GET` `/sessionSeries` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-series.get.ts)_
- [x] `POST` `/sessionSeries` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-series.post.ts)_
- [x] `GET` `/sessionSeries/:sessionSeriesId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-series.[sessionSeriesId].get.ts)_
- [x] `PUT` `/sessionSeries/:sessionSeriesId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/session-series.[sessionSeriesId].put.ts)_
- [x] `DELETE` `/sessionSeries/:sessionSeriesId/sessions/all` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/sessionSeries.[sessionSeriesId].sessions.all.delete.ts)_

## Sms Credit Checkouts (smsCreditCheckouts)

- [x] `GET` `/smsCreditCheckouts/:id` — security: none _(source: ../keepon-full/api-server/src/routes/sms-credit-checkouts.[id].get.ts)_

## Sms Credit Checkout Sessions (smsCreditCheckoutSessions)

- [x] `POST` `/smsCreditCheckoutSessions` — security: none _(source: ../keepon-full/api-server/src/routes/sms-credit-checkout-sessions.post.ts)_

## Stripe (stripe)

- [x] `GET` `/stripe/account` — security: `serviceProviderOrClient` _(source: ../keepon-full/api-server/src/routes/stripe.account.get.ts)_
- [x] `POST` `/stripe/account_links` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/stripe.account_links.post.ts)_
- [x] `GET` `/stripe/external_accounts` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/stripe.external_accounts.get.ts)_
- [x] `POST` `/stripe/external_accounts` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/stripe.external_accounts.post.ts)_

## Stripe Events (stripeEvents)

- [x] `POST` `/stripeEvents` — security: none _(source: ../keepon-full/api-server/src/routes/stripe-events.post.ts)_

## Stripe Onboarding Links (stripeOnboardingLinks)

- [x] `POST` `/stripeOnboardingLinks` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/stripe-onboarding-links.post.ts)_

## Stripe Setup Intents (stripeSetupIntents)

- [x] `POST` `/stripeSetupIntents` — security: `client` _(source: ../keepon-full/api-server/src/routes/stripe-setup-intents.post.ts)_

## Trainer (trainer)

- [x] `POST` `/trainer/upload` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainer.upload.post.ts)_

## Trainers (trainers)

- [x] `POST` `/trainers` — security: none _(source: ../keepon-full/api-server/src/routes/trainers.post.ts)_
- [ ] `GET` `/trainers/:trainerId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].get.ts)_
- [ ] `PUT` `/trainers/:trainerId` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].put.ts)_
- [x] `GET` `/trainers/:trainerId/clients` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].clients.get.ts)_
- [ ] `POST` `/trainers/:trainerId/clients` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].clients.post.ts)_
- [x] `GET` `/trainers/:trainerId/financeItems` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].financeItems.get.ts)_
- [ ] `POST` `/trainers/:trainerId/financeItems` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].financeItems.post.ts)_
- [x] `PUT` `/trainers/:trainerId/notifications/:notificationId/view` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].notifications.[notificationId].view.put.ts)_
- [x] `GET` `/trainers/:trainerId/notifications/all` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].notifications.all.get.ts)_
- [x] `GET` `/trainers/:trainerId/notifications/new` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].notifications.new.get.ts)_
- [x] `PUT` `/trainers/:trainerId/notifications/view` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].notifications.view.put.ts)_
- [x] `GET` `/trainers/:trainerId/stripeAccount` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].stripeAccount.get.ts)_
- [x] `GET` `/trainers/:trainerId/taxes` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].taxes.get.ts)_
- [x] `GET` `/trainers/:trainerId/taxItems` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trainers.[trainerId].taxItems.get.ts)_

## Transaction Fee (transactionFee)

- [x] `GET` `/transactionFee` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/transaction-fee.get.ts)_

## Trials (trials)

- [x] `POST` `/trials` — security: `serviceProvider` _(source: ../keepon-full/api-server/src/routes/trials.post.ts)_

## Twilio Status Message (twilioStatusMessage)

- [ ] `POST` `/twilioStatusMessage` — security: none _(source: ../keepon-full/api-server/src/routes/twilio-status-message.post.ts)_
