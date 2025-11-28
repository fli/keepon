import { createTanstackQueryUtils } from '@orpc/tanstack-query'

import { orpcClient } from './client'

// React Query helpers generated from the shared oRPC client.
export const orpcQuery = createTanstackQueryUtils(orpcClient)

export { createTanstackQueryUtils }
