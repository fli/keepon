import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const LEGACY_ROOT = '/Users/francis/repos/keepon-full/api-server'
const LEGACY_ROUTES = path.join(LEGACY_ROOT, 'src/routes')
const NEW_ROOT = process.cwd()
const NEW_API_ROOT = path.join(NEW_ROOT, 'src/app/api')

const DEFAULT_NEW_PORT = 3001
const DEFAULT_LEGACY_PORT = 3002

const readArg = (name) => {
  const index = process.argv.indexOf(name)
  return index !== -1 ? process.argv[index + 1] : undefined
}

const hasFlag = (name) => process.argv.includes(name)

const legacyPort = Number(readArg('--legacy-port') ?? DEFAULT_LEGACY_PORT)
const newPort = Number(readArg('--new-port') ?? DEFAULT_NEW_PORT)
const shouldStart = !hasFlag('--no-start')
const shouldRun = !hasFlag('--no-run')
const keepLogs = hasFlag('--keep-logs')
const databaseUrlArg = readArg('--database-url')

const walkFiles = (dir, predicate) => {
  const output = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      const stats = statSync(full)
      if (stats.isDirectory()) {
        stack.push(full)
      } else if (predicate(full)) {
        output.push(full)
      }
    }
  }
  return output
}

const parseLegacyRoutes = (root) => {
  const files = walkFiles(root, (file) => file.endsWith('.ts'))
  const routes = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const match = content.match(/router\.(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]+)\2/)
    if (!match) {
      continue
    }
    const method = match[1].toUpperCase()
    const routePath = match[3]
    let security = null
    const securityMatch = content.match(/security:\s*(['"`])([^'"`]+)\1/)
    if (securityMatch) {
      security = securityMatch[2]
    } else if (/security:\s*null/.test(content)) {
      security = null
    }
    routes.push({ method, path: routePath, security, file })
  }
  return routes
}

const buildEnvFromDotenv = (filePath) => {
  try {
    const content = readFileSync(filePath, 'utf8')
    const env = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const index = trimmed.indexOf('=')
      if (index === -1) {
        continue
      }
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim()
      env[key] = value
    }
    return env
  } catch {
    return {}
  }
}

const parseDatabaseUrl = (value) => {
  try {
    const url = new URL(value)
    return {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.replace(/^\//, ''),
    }
  } catch {
    return {}
  }
}

const isLocalHost = (value) => value === 'localhost' || value === '127.0.0.1'

const buildLegacyEnv = () => {
  const dotenvLocal = path.join(NEW_ROOT, '.env.local')
  const dotenvBase = path.join(NEW_ROOT, '.env')
  const baseEnv = {
    ...buildEnvFromDotenv(dotenvBase),
    ...buildEnvFromDotenv(dotenvLocal),
  }

  const legacyEnv = { ...process.env }
  if (baseEnv.DATABASE_URL) {
    Object.assign(legacyEnv, parseDatabaseUrl(baseEnv.DATABASE_URL))
  }
  if (databaseUrlArg) {
    Object.assign(legacyEnv, parseDatabaseUrl(databaseUrlArg))
  }
  if (baseEnv.PGHOST) {
    legacyEnv.PGHOST = baseEnv.PGHOST
  }
  if (baseEnv.PGPORT) {
    legacyEnv.PGPORT = baseEnv.PGPORT
  }
  if (baseEnv.PGUSER) {
    legacyEnv.PGUSER = baseEnv.PGUSER
  }
  if (baseEnv.PGPASSWORD) {
    legacyEnv.PGPASSWORD = baseEnv.PGPASSWORD
  }
  if (baseEnv.PGDATABASE) {
    legacyEnv.PGDATABASE = baseEnv.PGDATABASE
  }

  legacyEnv.PORT = String(legacyPort)
  legacyEnv.BASE_URL = `http://localhost:${legacyPort}`
  legacyEnv.STRIPE_API_KEY = legacyEnv.STRIPE_API_KEY ?? baseEnv.STRIPE_API_KEY ?? 'sk_test_dummy'
  return legacyEnv
}

const waitForUrl = async (url, timeoutMs = 60000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(url, { method: 'GET', signal: controller.signal })
      clearTimeout(timer)
      if (res) {
        return true
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

const placeholderValue = (name) => {
  const lower = name.toLowerCase()
  if (lower.includes('imageurl')) {
    return 'test.jpg'
  }
  if (lower.includes('slug')) {
    return 'test'
  }
  if (lower.includes('token')) {
    return 'test-token'
  }
  if (lower.includes('id')) {
    return '00000000-0000-0000-0000-000000000000'
  }
  return 'test'
}

const fillParams = (routePath) =>
  routePath.replaceAll(/:([A-Za-z0-9_]+)/g, (_, name) => encodeURIComponent(placeholderValue(name)))

const buildRequestInit = (method, security) => {
  const headers = {}
  let body

  if (security && security !== 'none') {
    headers.Authorization = 'Bearer invalid'
  }

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({})
  }

  return { headers, body, method }
}

const runDiff = async (routes) => {
  const results = []
  for (const route of routes) {
    const filledPath = fillParams(route.path)
    const legacyUrl = `http://localhost:${legacyPort}/api${filledPath}`
    const newUrl = `http://localhost:${newPort}/api${filledPath}`
    const init = buildRequestInit(route.method, route.security)

    let legacyStatus = 'ERR'
    let newStatus = 'ERR'
    let legacyBody = ''
    let newBody = ''

    try {
      const res = await fetch(legacyUrl, init)
      legacyStatus = res.status
      legacyBody = await res.text()
    } catch (error) {
      legacyBody = String(error)
    }

    try {
      const res = await fetch(newUrl, init)
      newStatus = res.status
      newBody = await res.text()
    } catch (error) {
      newBody = String(error)
    }

    results.push({
      route,
      legacyUrl,
      newUrl,
      legacyStatus,
      newStatus,
      legacyBody,
      newBody,
    })
  }

  return results
}

const summarize = (results) => {
  const mismatches = results.filter((entry) => entry.legacyStatus !== entry.newStatus)
  console.log(`Compared ${results.length} routes`)
  console.log(`Status mismatches: ${mismatches.length}`)
  if (mismatches.length) {
    console.log('')
    for (const mismatch of mismatches) {
      console.log(`- ${mismatch.route.method} /api${mismatch.route.path}`)
      console.log(`  legacy: ${mismatch.legacyStatus}  new: ${mismatch.newStatus}`)
    }
  }
  return mismatches
}

const spawnServer = (command, args, options) =>
  spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options })

const startServers = async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'keepon-api-diff-'))
  const legacyLog = path.join(tempDir, 'legacy.log')
  const newLog = path.join(tempDir, 'new.log')
  const legacyStream = createWriteStream(legacyLog, { flags: 'a' })
  const newStream = createWriteStream(newLog, { flags: 'a' })

  const legacyEnv = buildLegacyEnv()
  legacyEnv.TS_NODE_PROJECT = legacyEnv.TS_NODE_PROJECT ?? 'tsconfig.json'

  const legacyProc = spawnServer(
    'node',
    ['-r', 'ts-node/register/transpile-only', '-r', 'dotenv/config', 'src/index.js'],
    {
      cwd: LEGACY_ROOT,
      env: legacyEnv,
    }
  )
  const newProc = spawnServer('pnpm', ['dev'], {
    cwd: NEW_ROOT,
    env: {
      ...process.env,
      ...(databaseUrlArg ? { DATABASE_URL: databaseUrlArg } : null),
    },
  })

  legacyProc.stdout.pipe(legacyStream)
  legacyProc.stderr.pipe(legacyStream)
  newProc.stdout.pipe(newStream)
  newProc.stderr.pipe(newStream)

  return { tempDir, legacyLog, newLog, legacyProc, newProc, legacyStream, newStream }
}

const stopProcess = (proc) => {
  if (!proc || proc.killed) {
    return
  }
  try {
    process.kill(-proc.pid, 'SIGTERM')
  } catch {
    try {
      proc.kill('SIGTERM')
    } catch {}
  }
}

const main = async () => {
  const routes = parseLegacyRoutes(LEGACY_ROUTES)
  let procs
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    if (procs) {
      stopProcess(procs.legacyProc)
      stopProcess(procs.newProc)
      procs.legacyStream?.end()
      procs.newStream?.end()
      if (keepLogs) {
        console.log(`Logs retained at ${procs.tempDir}`)
      } else {
        rmSync(procs.tempDir, { recursive: true, force: true })
      }
    }
  }

  process.on('SIGINT', () => {
    cleanup()
    process.exit(1)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(1)
  })

  if (shouldStart) {
    if (newPort !== DEFAULT_NEW_PORT) {
      console.log(
        `New server is hardcoded to ${DEFAULT_NEW_PORT} in package.json. ` +
          'Use --no-start and launch it yourself if you need a different port.'
      )
      process.exit(1)
    }
    const legacyEnv = buildLegacyEnv()
    if (!legacyEnv.PGHOST) {
      console.log('Missing PGHOST/PGDATABASE env for legacy server. Provide a local database first.')
      process.exit(1)
    }
    if (!isLocalHost(legacyEnv.PGHOST) && !hasFlag('--allow-remote-db')) {
      console.log(
        `Refusing to start legacy server against non-local database host (${legacyEnv.PGHOST}). ` +
          'Use --allow-remote-db if this is intentional.'
      )
      process.exit(1)
    }
    procs = await startServers()
    const legacyReady = await waitForUrl(`http://localhost:${legacyPort}/api/config`)
    const newReady = await waitForUrl(`http://localhost:${newPort}/api/config`)
    if (!legacyReady || !newReady) {
      console.log('Failed to start servers within timeout.')
      cleanup()
      process.exit(1)
    }
  }

  if (shouldRun) {
    const results = await runDiff(routes)
    summarize(results)
  }

  cleanup()
}

await main()
