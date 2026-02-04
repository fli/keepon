import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type RouteParityCheck = {
  id: string
  fullFile: string
  solitoFile: string
  expectedTaskTypes: string[]
  notes?: string
}

const fullRepoRoot = process.env.KEEPON_FULL_PATH ?? '/Users/francis/repos/keepon-full'
const solitoRoot = process.cwd()

const routeChecks: RouteParityCheck[] = [
  {
    id: '/members/:memberId/devices',
    fullFile: 'api-server/src/routes/members.[memberId].devices.post.ts',
    solitoFile: 'src/app/api/members/[userId]/devices/route.ts',
    expectedTaskTypes: ['user.notify'],
  },
  {
    id: '/sessionInvitationLinks/:invitationId',
    fullFile: 'api-server/src/routes/session-invitation-links.[invitationId].get.ts',
    solitoFile: 'src/app/api/sessionInvitationLinks/[invitationId]/route.ts',
    expectedTaskTypes: ['user.notify'],
  },
  {
    id: '/onlineBookings/bookings/:bookingId/cancel',
    fullFile: 'api-server/src/routes/online-bookings.bookings.[bookingId].cancel.post.ts',
    solitoFile: 'src/app/api/onlineBookings/bookings/[bookingId]/cancel/route.ts',
    expectedTaskTypes: ['user.notify'],
  },
  {
    id: '/plans/:planId/accept',
    fullFile: 'api-server/src/routes/plans.[planId].accept.put.ts',
    solitoFile: 'src/app/api/plans/[planId]/accept/route.ts',
    expectedTaskTypes: ['user.notify'],
    notes: 'Full route runs outstanding-plan charging inline (not queued).',
  },
  {
    id: '/plans/:planId/retry',
    fullFile: 'api-server/src/routes/plans.[planId].retry.put.ts',
    solitoFile: 'src/app/api/plans/[planId]/retry/route.ts',
    expectedTaskTypes: [],
    notes: 'Full route runs outstanding-plan charging inline (not queued).',
  },
  {
    id: '/bookings',
    fullFile: 'api-server/src/routes/bookings.post.ts',
    solitoFile: 'src/app/api/bookings/route.ts',
    expectedTaskTypes: ['user.notify'],
  },
  {
    id: '/salePayments',
    fullFile: 'api-server/src/routes/sale-payments.post.ts',
    solitoFile: 'src/app/api/salePayments/route.ts',
    expectedTaskTypes: ['user.notify'],
  },
  {
    id: '/trainers/:trainerId',
    fullFile: 'api-server/src/routes/trainers.[trainerId].put.ts',
    solitoFile: 'src/app/api/trainers/[trainerId]/route.ts',
    expectedTaskTypes: ['mailchimp.refresh_user_properties'],
  },
  {
    id: '/trainers',
    fullFile: 'api-server/src/routes/trainers.post.ts',
    solitoFile: 'src/server/trainers.ts',
    expectedTaskTypes: ['createStripeAccount', 'mailchimp.subscribe'],
  },
]

const extractTaskTypesFromFullFile = (filePath: string) => {
  const source = readFileSync(filePath, 'utf8')

  const taskTypes = new Set<string>()

  for (const match of source.matchAll(/taskType\s*:\s*'([^']+)'/g)) {
    taskTypes.add(match[1])
  }

  return [...taskTypes]
}

const extractWorkflowOutboxTaskTypesFromSolitoFile = (filePath: string) => {
  const source = readFileSync(filePath, 'utf8')

  const taskTypes = new Set<string>()

  for (const match of source.matchAll(/enqueueWorkflowTask\([^,]+,\s*'([^']+)'/g)) {
    taskTypes.add(match[1])
  }

  return [...taskTypes]
}

const findLegacyTaskQueueUsage = (source: string) => {
  const matches: number[] = []
  for (const match of source.matchAll(/INSERT\s+INTO\s+task_queue/gi)) {
    if (typeof match.index === 'number') {
      matches.push(match.index)
    }
  }
  return matches
}

const read = (relativePath: string) => readFileSync(resolve(solitoRoot, relativePath), 'utf8')

const migrationPath = resolve(solitoRoot, 'db/migrations/20260204170000_workflow_outbox.sql')
const migrationExists = existsSync(migrationPath)

let hasFailures = false

console.log('Workflow Outbox Parity Check')
console.log(`fullRepoRoot: ${fullRepoRoot}`)
console.log(`solitoRoot: ${solitoRoot}`)
console.log('')

for (const check of routeChecks) {
  const fullPath = resolve(fullRepoRoot, check.fullFile)
  const solitoPath = resolve(solitoRoot, check.solitoFile)

  if (!existsSync(fullPath)) {
    hasFailures = true
    console.log(`[FAIL] ${check.id}`)
    console.log(`  missing full route file: ${fullPath}`)
    continue
  }

  if (!existsSync(solitoPath)) {
    hasFailures = true
    console.log(`[FAIL] ${check.id}`)
    console.log(`  missing solito route file: ${solitoPath}`)
    continue
  }

  const fullTaskTypes = extractTaskTypesFromFullFile(fullPath)
  const solitoTaskTypes = extractWorkflowOutboxTaskTypesFromSolitoFile(solitoPath)

  const expected = check.expectedTaskTypes
  const missing = expected.filter((taskType) => !solitoTaskTypes.includes(taskType))

  if (missing.length > 0) {
    hasFailures = true
    console.log(`[FAIL] ${check.id}`)
    console.log(`  expected tasks from full route: ${expected.join(', ') || '(none)'}`)
    console.log(`  full route task types detected: ${fullTaskTypes.join(', ') || '(none)'}`)
    console.log(`  solito outbox task types detected: ${solitoTaskTypes.join(', ') || '(none)'}`)
    console.log(`  missing in solito: ${missing.join(', ')}`)
    if (check.notes) {
      console.log(`  note: ${check.notes}`)
    }
    continue
  }

  console.log(`[PASS] ${check.id}`)
  console.log(`  full route task types detected: ${fullTaskTypes.join(', ') || '(none)'}`)
  console.log(`  solito outbox task types detected: ${solitoTaskTypes.join(', ') || '(none)'}`)
  if (check.notes) {
    console.log(`  note: ${check.notes}`)
  }
}

console.log('')

const legacyTaskQueueScanTargets = [
  'src/app/api/members/[userId]/devices/route.ts',
  'src/app/api/sessionInvitationLinks/[invitationId]/route.ts',
  'src/app/api/onlineBookings/bookings/[bookingId]/cancel/route.ts',
  'src/app/api/plans/[planId]/accept/route.ts',
  'src/app/api/plans/[planId]/retry/route.ts',
]

for (const filePath of legacyTaskQueueScanTargets) {
  const source = read(filePath)
  const matches = findLegacyTaskQueueUsage(source)
  if (matches.length > 0) {
    hasFailures = true
    console.log(`[FAIL] legacy task_queue SQL remains in ${filePath}`)
  } else {
    console.log(`[PASS] no task_queue SQL in ${filePath}`)
  }
}

console.log('')

if (!migrationExists) {
  hasFailures = true
  console.log(`[FAIL] migration missing: ${migrationPath}`)
} else {
  const migration = readFileSync(migrationPath, 'utf8')
  const requiredSnippets = [
    'CREATE TABLE IF NOT EXISTS public.workflow_outbox',
    'CREATE TABLE IF NOT EXISTS public.workflow_task_execution',
    'CREATE OR REPLACE FUNCTION public.enqueue_workflow_outbox',
    'CREATE OR REPLACE FUNCTION public.process_stripe_event()',
    'CREATE OR REPLACE FUNCTION public.queue_mandrill_event()',
    'CREATE OR REPLACE FUNCTION public.send_mail()',
    'CREATE OR REPLACE FUNCTION public.send_sms()',
  ]

  const missingSnippets = requiredSnippets.filter((snippet) => !migration.includes(snippet))

  if (missingSnippets.length > 0) {
    hasFailures = true
    console.log('[FAIL] workflow outbox migration is missing required statements')
    for (const snippet of missingSnippets) {
      console.log(`  missing: ${snippet}`)
    }
  } else {
    console.log('[PASS] workflow outbox migration includes required statements')
  }
}

console.log('')

if (hasFailures) {
  console.log('Result: FAILED')
  process.exitCode = 1
} else {
  console.log('Result: PASSED')
}
