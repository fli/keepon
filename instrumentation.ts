const globalForWorkflowDispatcher = globalThis as {
  __keeponWorkflowDispatcherStop?: (() => void) | null
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  const isVercel = process.env.VERCEL === '1'

  const { getWorld } = await import('workflow/runtime')
  await getWorld().start?.()

  if (globalForWorkflowDispatcher.__keeponWorkflowDispatcherStop || isVercel) {
    return
  }

  const { startWorkflowOutboxDispatcher } = await import('./src/server/workflow/dispatcher')
  globalForWorkflowDispatcher.__keeponWorkflowDispatcherStop = startWorkflowOutboxDispatcher()

  const { seedRecurringTasks } = await import('./src/server/workflow/schedules')
  await seedRecurringTasks()
}
