import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const LEGACY_ROOT_DEFAULT = '/Users/francis/repos/keepon-full/api-server/src/routes'
const NEW_ROOT_DEFAULT = path.join(process.cwd(), 'src/app/api')

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const readArg = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const legacyRoot = readArg('--legacy-root') ?? LEGACY_ROOT_DEFAULT
const newRoot = readArg('--new-root') ?? NEW_ROOT_DEFAULT

const walkFiles = (dir, predicate) => {
  const output = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
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
    if (!match) continue

    const method = match[1].toUpperCase()
    const routePath = match[3]
    let security = null
    const securityMatch = content.match(/security:\s*(['"`])([^'"`]+)\1/)
    if (securityMatch) {
      security = securityMatch[2]
    } else if (content.match(/security:\s*null/)) {
      security = null
    }

    routes.push({
      method,
      path: routePath,
      security,
      file,
    })
  }

  return routes
}

const toRoutePath = (file, root) => {
  const rel = path.relative(root, file)
  const parts = rel.replace(/\\/g, '/').split('/')
  parts.pop()
  const mapped = parts
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('[[...') && part.endsWith(']]')) {
        const name = part.slice(5, -2)
        return `:${name}*`
      }
      if (part.startsWith('[...') && part.endsWith(']')) {
        const name = part.slice(4, -1)
        return `:${name}*`
      }
      if (part.startsWith('[') && part.endsWith(']')) {
        const name = part.slice(1, -1)
        return `:${name}`
      }
      return part
    })
  return `/api/${mapped.join('/')}`
}

const parseNewRoutes = (root) => {
  const files = walkFiles(root, (file) => /\/route\.(ts|js|tsx|jsx)$/.test(file))
  const routes = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const methods = new Set()

    for (const match of content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
      methods.add(match[1])
    }

    for (const match of content.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
      methods.add(match[1])
    }

    for (const match of content.matchAll(/export\s*{\s*([^}]+)\s*}/g)) {
      const items = match[1].split(',')
      for (const raw of items) {
        const item = raw.trim()
        if (!item) continue
        const parts = item.split(/\s+as\s+/i).map((value) => value.trim())
        const alias = parts.length > 1 ? parts[1] : parts[0]
        if (METHODS.has(alias)) {
          methods.add(alias)
        }
      }
    }

    if (methods.size === 0) continue
    const routePath = toRoutePath(file, root)
    for (const method of methods) {
      routes.push({ method, path: routePath, file })
    }
  }

  return routes
}

const normalizePath = (value) => value.replace(/:([A-Za-z0-9_]+)/g, ':param')

const compareRoutes = (legacy, nextRoutes) => {
  const legacySet = new Map()
  const nextSet = new Map()

  for (const route of legacy) {
    const key = `${route.method} ${normalizePath(`/api${route.path}`)}`
    legacySet.set(key, route)
  }

  for (const route of nextRoutes) {
    const key = `${route.method} ${normalizePath(route.path)}`
    nextSet.set(key, route)
  }

  const missing = []
  const extra = []

  for (const [key, route] of legacySet.entries()) {
    if (!nextSet.has(key)) {
      missing.push(route)
    }
  }

  for (const [key, route] of nextSet.entries()) {
    if (!legacySet.has(key)) {
      extra.push(route)
    }
  }

  return { missing, extra, legacyCount: legacySet.size, nextCount: nextSet.size }
}

const legacyRoutes = parseLegacyRoutes(legacyRoot)
const newRoutes = parseNewRoutes(newRoot)
const comparison = compareRoutes(legacyRoutes, newRoutes)

const formatList = (entries) => (entries.length ? entries.join('\n') : '  (none)')

const missingLines = comparison.missing
  .map((route) => `  - ${route.method} /api${route.path}  (legacy: ${path.relative(legacyRoot, route.file)})`)
  .sort()

const extraLines = comparison.extra
  .map((route) => `  - ${route.method} ${route.path}  (new: ${path.relative(process.cwd(), route.file)})`)
  .sort()

console.log(`Legacy routes: ${comparison.legacyCount}`)
console.log(`New routes:    ${comparison.nextCount}`)
console.log('')
console.log('Missing in new implementation:')
console.log(formatList(missingLines))
console.log('')
console.log('Extra in new implementation:')
console.log(formatList(extraLines))
