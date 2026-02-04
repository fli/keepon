const globalForWorkflowDispatcher = globalThis as {
  __keeponWorkflowDispatcherStop?: (() => void) | null
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  const { getWorld } = await import('workflow/runtime')
  await getWorld().start?.()

  if (globalForWorkflowDispatcher.__keeponWorkflowDispatcherStop) {
    return
  }

  const { startWorkflowOutboxDispatcher } = await import('./src/server/workflow/dispatcher')
  globalForWorkflowDispatcher.__keeponWorkflowDispatcherStop = startWorkflowOutboxDispatcher()

  const { seedRecurringTasks } = await import('./src/server/workflow/schedules')
  await seedRecurringTasks()
}
