import { Suspense } from 'react'

import { AddClientScreen } from 'app/features/clients/add-client-screen'
import { ClientsLoading } from 'app/features/clients/loading'
import { createClientAction } from '../../actions'

export default function AddClientModalPage() {
  return (
    <Suspense fallback={<ClientsLoading title="Opening add client" />}> 
      <AddClientScreen createClientAction={createClientAction} variant="modal" />
    </Suspense>
  )
}
