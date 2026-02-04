import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { readdirSync, statSync, readFileSync, mkdirSync, createWriteStream, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LEGACY_ROOT = '/Users/francis/repos/keepon-full/api-server'
const LEGACY_ROUTES = path.join(LEGACY_ROOT, 'src/routes')
const LEGACY_MIGRATION_DIR = path.join(LEGACY_ROOT, 'src/migration')
const NEW_ROOT = process.cwd()
const requireFromLegacy = createRequire(path.join(LEGACY_ROOT, 'package.json'))
const ts = requireFromLegacy('typescript')

const DEFAULT_TEMPLATE_DB = 'keepon_solito_dev'
const DEFAULT_LEGACY_PORT = 3002
const DEFAULT_NEW_PORT = 3001

const readArg = (name) => {
  const index = process.argv.indexOf(name)
  return index !== -1 ? process.argv[index + 1] : undefined
}
const hasFlag = (name) => process.argv.includes(name)

const templateDb = readArg('--template-db') ?? DEFAULT_TEMPLATE_DB
const keepDbs = hasFlag('--keep-dbs')
const keepLogs = hasFlag('--keep-logs')
const filterRouteArg = readArg('--route')
const filterScenarioArg = readArg('--scenario')
const verboseMismatch = hasFlag('--verbose-mismatch')
const resetFixtures = hasFlag('--reset-fixtures')
const showProgress = hasFlag('--progress')

const desiredLegacyPort = Number(readArg('--legacy-port') ?? DEFAULT_LEGACY_PORT)
const desiredNewPort = Number(readArg('--new-port') ?? DEFAULT_NEW_PORT)

const adminDbUrl = readArg('--admin-db-url') ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const REQUEST_TIMEOUT_MS = Number(readArg('--request-timeout') ?? 30000)

const MOCK_EXTERNAL_PATH = path.join(NEW_ROOT, 'scripts', 'mock-external.cjs')

const routeParamRegex = /:([A-Za-z0-9_]+)/g

const METHOD_HAS_BODY = new Set(['POST', 'PUT', 'PATCH'])
const METHOD_MUTATES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ORDER_INSENSITIVE_ROUTES = new Set(['GET /api/trainers/:trainerId/financeItems'])

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001'
const SAMPLE_EMAIL = 'test@example.com'
const SAMPLE_PHONE = '+12025550123'
const SAMPLE_DATE = '2020-01-01'
const SAMPLE_DATETIME = '2020-01-01T00:00:00.000Z'
const SAMPLE_URL = 'https://example.com'
const SAMPLE_SLUG = 'test-slug'
const SAMPLE_LOCALE = 'en-US'
const SAMPLE_TIMEZONE = 'UTC'
const SAMPLE_CURRENCY = 'USD'
const SAMPLE_DURATION = 'PT1H'
const SHARED_SAMPLE_MAP = new Map()

const FIXTURE_IDS = {
  A: {
    trainerUserId: '00000000-0000-4000-8000-0000000000a1',
    trainerId: '00000000-0000-4000-8000-0000000000a2',
    clientUserId: '00000000-0000-4000-8000-0000000000a3',
    clientId: '00000000-0000-4000-8000-0000000000a4',
  },
  B: {
    trainerUserId: '00000000-0000-4000-8000-0000000000b1',
    trainerId: '00000000-0000-4000-8000-0000000000b2',
    clientUserId: '00000000-0000-4000-8000-0000000000b3',
    clientId: '00000000-0000-4000-8000-0000000000b4',
  },
}

const AUTH_NONE = 'none'
const AUTH_VALID = 'valid'
const AUTH_INVALID = 'invalid'
const AUTH_EXPIRED = 'expired'
const AUTH_WRONG_TYPE = 'wrong_type'
const AUTH_OTHER_OWNER = 'other_owner'

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

const isPortOpen = (port, host) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const finalize = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finalize(true))
    socket.once('error', () => finalize(false))
    socket.setTimeout(200, () => finalize(false))
  })

const isPortAvailable = async (port) => {
  const openV4 = await isPortOpen(port, '127.0.0.1')
  const openV6 = await isPortOpen(port, '::1')
  return !(openV4 ?? openV6)
}

const resolvePort = async (desired, label, reserved = new Set()) => {
  const isCandidateAvailable = async (port) => !reserved.has(port) && (await isPortAvailable(port))
  if (await isCandidateAvailable(desired)) {
    return desired
  }
  for (let offset = 1; offset <= 20; offset += 1) {
    const candidate = desired + offset
    if (await isCandidateAvailable(candidate)) {
      console.warn(`${label} port ${desired} unavailable; falling back to ${candidate}`)
      return candidate
    }
  }
  throw new Error(`Unable to find free port near ${desired} for ${label} server`)
}

const awaitReadFile = (file) => readFileSync(file, 'utf8')

const readLegacyConfigMap = () => {
  const map = new Map()
  try {
    const content = awaitReadFile(path.join(LEGACY_ROOT, 'src/config.ts'))
    const regex = /export const ([A-Za-z0-9_]+)\s*=\s*(['"`])([^'"`]+)\2/g
    for (const match of content.matchAll(regex)) {
      map.set(match[1], match[3])
    }
  } catch {
    // ignore
  }
  return map
}

const LEGACY_CONFIG_MAP = readLegacyConfigMap()
const LEGACY_MIGRATION_RE = /^V([0-9.]+)__(.*)\.(sql|ts|js)$/

const listLegacyMigrations = () =>
  readdirSync(LEGACY_MIGRATION_DIR)
    .map((file) => ({ file, match: LEGACY_MIGRATION_RE.exec(file) }))
    .filter((entry) => entry.match)
    .toSorted((a, b) => {
      const first = parseInt(a.match[1].replaceAll(/\./g, ''), 10)
      const second = parseInt(b.match[1].replaceAll(/\./g, ''), 10)
      return first - second
    })
    .map(({ file, match }) => ({
      file,
      version: match[1],
      description: match[2].replaceAll(/_/g, ' '),
      type: match[3].toLowerCase(),
      fullPath: path.join(LEGACY_MIGRATION_DIR, file),
    }))

const isIdentifierNamed = (node, name) => ts.isIdentifier(node) && node.text === name

const getPropertyNameText = (nameNode) => {
  if (ts.isIdentifier(nameNode)) {
    return nameNode.text
  }
  if (ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) {
    return nameNode.text
  }
  return null
}

const resolveExpression = (expr, ctx, seen = new Set()) => {
  if (!expr || !ts.isIdentifier(expr)) {
    return expr
  }
  const name = expr.text
  if (seen.has(name)) {
    return expr
  }
  const init = ctx.varMap.get(name)
  if (!init) {
    return expr
  }
  seen.add(name)
  return resolveExpression(init, ctx, seen)
}

const extractStringLiteral = (expr, ctx) => {
  const resolved = resolveExpression(expr, ctx)
  if (!resolved) {
    return null
  }
  if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) {
    return resolved.text
  }
  if (ts.isPropertyAccessExpression(resolved) && isIdentifierNamed(resolved.expression, 'config')) {
    const value = LEGACY_CONFIG_MAP.get(resolved.name.text)
    if (value) {
      return value
    }
  }
  return null
}

const resolveObjectLiteral = (expr, ctx) => {
  const resolved = resolveExpression(expr, ctx)
  return resolved && ts.isObjectLiteralExpression(resolved) ? resolved : null
}

const getObjectProperty = (objExpr, name) => {
  if (!objExpr) {
    return null
  }
  for (const prop of objExpr.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const propName = getPropertyNameText(prop.name)
      if (propName === name) {
        return prop.initializer
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      if (prop.name.text === name) {
        return prop.name
      }
    }
  }
  return null
}

const collectObjectProperties = (objExpr, ctx, stack) => {
  const entries = []
  if (!objExpr) {
    return entries
  }
  for (const prop of objExpr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const spreadObj = resolveObjectLiteral(prop.expression, ctx)
      if (spreadObj) {
        entries.push(...collectObjectProperties(spreadObj, ctx, stack))
      }
      continue
    }
    if (ts.isPropertyAssignment(prop)) {
      const propName = getPropertyNameText(prop.name)
      if (propName) {
        entries.push([propName, prop.initializer])
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      entries.push([prop.name.text, prop.name])
    }
  }
  return entries
}

const getCallInfo = (callExpr) => {
  const expr = callExpr.expression
  if (ts.isPropertyAccessExpression(expr)) {
    return {
      objectName: ts.isIdentifier(expr.expression) ? expr.expression.text : null,
      propName: expr.name.text,
    }
  }
  if (ts.isIdentifier(expr)) {
    return { objectName: null, propName: expr.text }
  }
  return null
}

const sampleForName = (name, keyHint) => {
  const target = `${name ?? ''} ${keyHint ?? ''}`.toLowerCase()
  if (target.includes('email')) {
    return SAMPLE_EMAIL
  }
  if (target.includes('phone')) {
    return SAMPLE_PHONE
  }
  if (target.includes('datetime')) {
    return SAMPLE_DATETIME
  }
  if (target.includes('date')) {
    return SAMPLE_DATE
  }
  if (target.includes('timezone') || target.includes('time_zone')) {
    return SAMPLE_TIMEZONE
  }
  if (target.includes('locale')) {
    return SAMPLE_LOCALE
  }
  if (target.includes('currency')) {
    return SAMPLE_CURRENCY
  }
  if (target.includes('duration')) {
    return SAMPLE_DURATION
  }
  if (target.includes('url')) {
    return SAMPLE_URL
  }
  if (target.includes('slug')) {
    return SAMPLE_SLUG
  }
  if (target.includes('boolean')) {
    return true
  }
  if (target.includes('color') || target.includes('colour')) {
    return '#abcdef'
  }
  if (target.includes('uuid') || target.endsWith('id') || target.includes('_id')) {
    return SAMPLE_UUID
  }
  if (target.includes('number') || target.includes('int') || target.includes('lat') || target.includes('lng')) {
    return 1
  }
  if (
    target.includes('money') ||
    target.includes('price') ||
    target.includes('amount') ||
    target.includes('fee') ||
    target.includes('tax')
  ) {
    return '1'
  }
  if (target.includes('total') || target.includes('credit')) {
    return 1
  }
  if (
    target.includes('count') ||
    target.includes('quantity') ||
    target.includes('minutes') ||
    target.includes('hours')
  ) {
    return 1
  }
  if (target.includes('password')) {
    return 'password'
  }
  if (target.includes('is') || target.includes('has') || target.includes('enabled') || target.includes('active')) {
    return true
  }
  return 'Test'
}

const mergeSamples = (samples) => {
  const objectSamples = samples.filter((sample) => sample && typeof sample === 'object' && !Array.isArray(sample))
  if (!objectSamples.length) {
    return samples.find((sample) => sample !== undefined) ?? null
  }
  return Object.assign({}, ...objectSamples)
}

const isIdKey = (key) => /(^id$|_id$|Id$)/.test(key)
const isNumericKeyName = (key) =>
  /(amount|price|count|quantity|minutes|hours|duration|length|number|lat|lng|fee|tax|total|credit|retry|percent|percentage|rate|day|month|year|age|limit|offset|page|size)/i.test(
    key
  )
const FILE_KEY_RE = /(file|image|photo|avatar|document|attachment)/i
const MULTIPART_ROUTE_FIELDS = new Map([
  ['/trainer/upload', ['businessLogo']],
  ['/products/:productId/upload', ['coverImage']],
  ['/financeItems/:financeItemId/upload', ['image']],
])
const TIME_RANGE_START_RE = /(start|from|begin)/i
const TIME_RANGE_END_RE = /(end|to|until)/i

const collectKeyPaths = (value, predicate, path = [], acc = []) => {
  if (!value || typeof value !== 'object') {
    return acc
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectKeyPaths(entry, predicate, [...path, index], acc)
    })
    return acc
  }
  for (const [key, entry] of Object.entries(value)) {
    if (predicate(key, entry)) {
      acc.push([...path, key])
    }
    if (entry && typeof entry === 'object') {
      collectKeyPaths(entry, predicate, [...path, key], acc)
    }
  }
  return acc
}

const collectRangePairs = (sample) => {
  if (!sample || typeof sample !== 'object') {
    return []
  }
  const startPaths = collectKeyPaths(sample, (key) => TIME_RANGE_START_RE.test(key))
  const endPaths = collectKeyPaths(sample, (key) => TIME_RANGE_END_RE.test(key))
  const grouped = new Map()
  const addPath = (paths, kind) => {
    for (const path of paths) {
      if (!path.length) {
        continue
      }
      const parent = JSON.stringify(path.slice(0, -1))
      if (!grouped.has(parent)) {
        grouped.set(parent, {})
      }
      grouped.get(parent)[kind] = path
    }
  }
  addPath(startPaths, 'start')
  addPath(endPaths, 'end')
  const pairs = []
  for (const entry of grouped.values()) {
    if (entry.start && entry.end) {
      pairs.push({ startPath: entry.start, endPath: entry.end })
    }
  }
  return pairs
}

const formatPath = (pathParts) =>
  pathParts
    .map((part, index) => (typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`))
    .join('')
    .replaceAll(/\.\[/g, '[')

const dedupePaths = (paths) => {
  const seen = new Set()
  return paths.filter((path) => {
    const key = formatPath(path)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const cloneValue = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

const setValueByPath = (target, path, value) => {
  if (!target || !path?.length) {
    return false
  }
  let cursor = target
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    const next = path[i + 1]
    if (typeof key === 'number') {
      if (!Array.isArray(cursor)) {
        return false
      }
      cursor[key] ??= typeof next === 'number' ? [] : {}
      cursor = cursor[key]
      continue
    }
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = typeof next === 'number' ? [] : {}
    }
    cursor = cursor[key]
  }
  const last = path[path.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(cursor)) {
      return false
    }
    cursor[last] = value
    return true
  }
  cursor[last] = value
  return true
}

const collectRequiredKeys = (expr, ctx, stack = new Set()) => {
  if (!expr) {
    return new Set()
  }
  const resolved = resolveExpression(expr, ctx, stack)
  if (!resolved) {
    return new Set()
  }

  if (ts.isCallExpression(resolved)) {
    if (ts.isCallExpression(resolved.expression)) {
      const innerInfo = getCallInfo(resolved.expression)
      if (innerInfo?.propName === 'sum') {
        const variantsExpr = resolved.arguments[0]
        const variantsObj = resolveObjectLiteral(variantsExpr, ctx)
        if (variantsObj) {
          const entries = collectObjectProperties(variantsObj, ctx, stack)
          if (entries.length) {
            return collectRequiredKeys(entries[0][1], ctx, stack)
          }
        }
      }
    }

    const callInfo = getCallInfo(resolved)
    if (callInfo) {
      const prop = callInfo.propName
      if (prop === 'pipe' || prop === 'compose' || prop === 'refine' || prop === 'parse' || prop === 'fromRefinement') {
        const sets = resolved.arguments.map((arg) => collectRequiredKeys(arg, ctx, stack))
        return sets.reduce((acc, next) => new Set([...acc, ...next]), new Set())
      }
      if (prop === 'struct') {
        const objExpr = resolveObjectLiteral(resolved.arguments[0], ctx)
        const entries = collectObjectProperties(objExpr, ctx, stack)
        return new Set(entries.map(([key]) => key))
      }
      if (prop === 'partial') {
        return new Set()
      }
      if (prop === 'intersect') {
        const sets = resolved.arguments.map((arg) => collectRequiredKeys(arg, ctx, stack))
        return sets.reduce((acc, next) => new Set([...acc, ...next]), new Set())
      }
      if (prop === 'union') {
        return collectRequiredKeys(resolved.arguments[0], ctx, stack)
      }
      if (prop === 'sum') {
        const variantsExpr = resolved.arguments[1] ?? resolved.arguments[0]
        const variantsObj = resolveObjectLiteral(variantsExpr, ctx)
        if (variantsObj) {
          const entries = collectObjectProperties(variantsObj, ctx, stack)
          if (entries.length) {
            return collectRequiredKeys(entries[0][1], ctx, stack)
          }
        }
      }
    }
  }
  if (ts.isObjectLiteralExpression(resolved)) {
    const entries = collectObjectProperties(resolved, ctx, stack)
    return new Set(entries.map(([key]) => key))
  }
  return new Set()
}

const sampleFromStruct = (expr, ctx, stack) => {
  const objExpr = resolveObjectLiteral(expr, ctx)
  if (!objExpr) {
    return {}
  }
  const entries = collectObjectProperties(objExpr, ctx, stack)
  const result = {}
  for (const [key, valueExpr] of entries) {
    result[key] = sampleFromDecoderExpr(valueExpr, ctx, stack, key)
  }
  return result
}

const sampleFromDecoderExpr = (expr, ctx, stack = new Set(), keyHint) => {
  if (!expr) {
    return sampleForName('', keyHint)
  }
  const resolved = resolveExpression(expr, ctx, stack)
  if (!resolved) {
    return sampleForName('', keyHint)
  }

  if (ts.isCallExpression(resolved)) {
    if (ts.isCallExpression(resolved.expression)) {
      const innerInfo = getCallInfo(resolved.expression)
      if (innerInfo?.propName === 'sum') {
        const variantsExpr = resolved.arguments[0]
        const variantsObj = resolveObjectLiteral(variantsExpr, ctx)
        if (variantsObj) {
          const entries = collectObjectProperties(variantsObj, ctx, stack)
          if (entries.length) {
            return sampleFromDecoderExpr(entries[0][1], ctx, stack, entries[0][0])
          }
        }
      }
    }

    const callInfo = getCallInfo(resolved)
    if (callInfo) {
      const prop = callInfo.propName
      if (prop === 'pipe') {
        const samples = resolved.arguments.map((arg) => sampleFromDecoderExpr(arg, ctx, stack, keyHint))
        return mergeSamples(samples)
      }
      if (prop === 'struct' || prop === 'partial') {
        return sampleFromStruct(resolved.arguments[0], ctx, stack)
      }
      if (prop === 'intersect') {
        const samples = resolved.arguments.map((arg) => sampleFromDecoderExpr(arg, ctx, stack, keyHint))
        return mergeSamples(samples)
      }
      if (prop === 'union') {
        return sampleFromDecoderExpr(resolved.arguments[0], ctx, stack, keyHint)
      }
      if (prop === 'array') {
        return [sampleFromDecoderExpr(resolved.arguments[0], ctx, stack, keyHint)]
      }
      if (prop === 'tuple') {
        return resolved.arguments.map((arg) => sampleFromDecoderExpr(arg, ctx, stack, keyHint))
      }
      if (prop === 'literal') {
        const first = resolved.arguments[0]
        if (first && ts.isStringLiteral(first)) {
          return first.text
        }
        if (first && ts.isNumericLiteral(first)) {
          return Number(first.text)
        }
        if (first && first.kind === ts.SyntaxKind.NullKeyword) {
          return null
        }
        if (first && first.kind === ts.SyntaxKind.TrueKeyword) {
          return true
        }
        if (first && first.kind === ts.SyntaxKind.FalseKeyword) {
          return false
        }
        return sampleForName(prop, keyHint)
      }
      if (prop === 'nullable') {
        return sampleFromDecoderExpr(resolved.arguments[0], ctx, stack, keyHint)
      }
      if (prop === 'compose' || prop === 'refine' || prop === 'parse' || prop === 'fromRefinement') {
        return sampleFromDecoderExpr(resolved.arguments[0], ctx, stack, keyHint)
      }
      if (prop === 'sum') {
        const variantsExpr = resolved.arguments[1] ?? resolved.arguments[0]
        const variantsObj = resolveObjectLiteral(variantsExpr, ctx)
        if (variantsObj) {
          const entries = collectObjectProperties(variantsObj, ctx, stack)
          if (entries.length) {
            return sampleFromDecoderExpr(entries[0][1], ctx, stack, entries[0][0])
          }
        }
      }
      if (prop === 'UnknownRecord' || prop === 'unknown') {
        return {}
      }
      if (prop === 'id') {
        return SAMPLE_UUID
      }
      if (prop === 'minimum' || prop === 'exclusiveMinimum') {
        const num = resolved.arguments[0]
        if (num && ts.isNumericLiteral(num)) {
          return Number(num.text) + (prop === 'exclusiveMinimum' ? 1 : 0)
        }
        return 1
      }
      if (prop === 'maximum') {
        const num = resolved.arguments[0]
        if (num && ts.isNumericLiteral(num)) {
          return Number(num.text)
        }
        return 1
      }
      if (prop === 'minLength') {
        const num = resolved.arguments[0]
        const length = num && ts.isNumericLiteral(num) ? Number(num.text) : 1
        return 'x'.repeat(Math.max(1, length))
      }
      if (prop === 'max' || prop === 'maxLength') {
        return sampleForName(prop, keyHint)
      }
    }
  }

  if (ts.isPropertyAccessExpression(resolved)) {
    if (ts.isIdentifier(resolved.expression) && resolved.expression.text === 'shared') {
      if (SHARED_SAMPLE_MAP.has(resolved.name.text)) {
        return SHARED_SAMPLE_MAP.get(resolved.name.text)
      }
    }
    return sampleForName(resolved.name.text, keyHint)
  }

  if (ts.isIdentifier(resolved)) {
    return sampleForName(resolved.text, keyHint)
  }

  if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) {
    return resolved.text
  }
  if (ts.isNumericLiteral(resolved)) {
    return Number(resolved.text)
  }
  if (resolved.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  if (resolved.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }
  if (ts.isObjectLiteralExpression(resolved)) {
    const hasDecode = resolved.properties.some((prop) => {
      if (ts.isPropertyAssignment(prop)) {
        return getPropertyNameText(prop.name) === 'decode'
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        return prop.name.text === 'decode'
      }
      return false
    })
    if (hasDecode) {
      return sampleForName('', keyHint)
    }
    return sampleFromStruct(resolved, ctx, stack)
  }

  return sampleForName('', keyHint)
}

const buildSharedSampleMap = () => {
  try {
    const sharedPath = path.join(LEGACY_ROOT, 'src/types/api/_shared.ts')
    const content = awaitReadFile(sharedPath)
    const sourceFile = ts.createSourceFile(sharedPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const varMap = new Map()
    const exportNames = new Set()

    sourceFile.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) {
        return
      }
      const isExported = node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          varMap.set(decl.name.text, decl.initializer)
          if (isExported) {
            exportNames.add(decl.name.text)
          }
        }
      }
    })

    const ctx = { sourceFile, varMap }
    for (const name of exportNames) {
      const expr = varMap.get(name)
      if (!expr) {
        continue
      }
      const sample = sampleFromDecoderExpr(expr, ctx, new Set(), name)
      SHARED_SAMPLE_MAP.set(name, sample)
    }
  } catch {
    // ignore
  }
}

buildSharedSampleMap()

const parseLegacyRoutes = () => {
  const files = walkFiles(LEGACY_ROUTES, (file) => file.endsWith('.ts'))
  const routes = []
  for (const file of files) {
    const content = awaitReadFile(file)
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const varMap = new Map()
    sourceFile.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) {
        return
      }
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          varMap.set(decl.name.text, decl.initializer)
        }
      }
    })
    const ctx = { sourceFile, varMap }

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text
        const target = node.expression.expression
        if (ts.isIdentifier(target) && target.text === 'router') {
          const methodUpper = method.toUpperCase()
          if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(methodUpper)) {
            const pathExpr = node.arguments[0]
            const routePath = extractStringLiteral(pathExpr, ctx)
            if (routePath) {
              const optionsExpr = node.arguments[1]
              const optionsObj = resolveObjectLiteral(optionsExpr, ctx)
              const securityExpr = optionsObj ? getObjectProperty(optionsObj, 'security') : null
              let security = null
              if (securityExpr) {
                const securityValue = extractStringLiteral(securityExpr, ctx)
                if (securityValue) {
                  security = securityValue
                }
                if (securityExpr.kind === ts.SyntaxKind.NullKeyword) {
                  security = null
                }
              }
              const bodyExpr =
                (optionsObj ? getObjectProperty(optionsObj, 'bodyParameters') : null) ??
                (optionsObj ? getObjectProperty(optionsObj, 'requestBody') : null)
              const queryExpr = optionsObj ? getObjectProperty(optionsObj, 'queryParameters') : null

              const bodySample = bodyExpr ? sampleFromDecoderExpr(bodyExpr, ctx) : null
              const querySample = queryExpr ? sampleFromDecoderExpr(queryExpr, ctx) : null
              const bodyRequiredKeys = bodyExpr ? [...collectRequiredKeys(bodyExpr, ctx)] : []
              const queryRequiredKeys = queryExpr ? [...collectRequiredKeys(queryExpr, ctx)] : []
              const bodyIdPaths = bodySample ? dedupePaths(collectKeyPaths(bodySample, (key) => isIdKey(key))) : []
              const bodyNumericPaths = bodySample
                ? dedupePaths(
                    collectKeyPaths(bodySample, (key, entry) => typeof entry === 'number' || isNumericKeyName(key))
                  )
                : []
              const queryIdPaths =
                querySample && typeof querySample === 'object' && !Array.isArray(querySample)
                  ? dedupePaths(collectKeyPaths(querySample, (key) => isIdKey(key)))
                  : []
              const queryNumericPaths =
                querySample && typeof querySample === 'object' && !Array.isArray(querySample)
                  ? dedupePaths(
                      collectKeyPaths(querySample, (key, entry) => typeof entry === 'number' || isNumericKeyName(key))
                    )
                  : []
              const bodyTimeRangePairs = bodySample ? collectRangePairs(bodySample) : []
              const queryTimeRangePairs =
                querySample && typeof querySample === 'object' && !Array.isArray(querySample)
                  ? collectRangePairs(querySample)
                  : []
              const overrideMultipartFields = MULTIPART_ROUTE_FIELDS.get(routePath)
              const multipartFields = overrideMultipartFields ?? []

              routes.push({
                method: methodUpper,
                path: routePath,
                security,
                file,
                bodySample,
                querySample,
                bodyRequiredKeys,
                queryRequiredKeys,
                bodyIdPaths,
                bodyNumericPaths,
                queryIdPaths,
                queryNumericPaths,
                bodyTimeRangePairs,
                queryTimeRangePairs,
                multipartFields,
              })
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }
  return routes
}

const normalizePathParams = (path) => {
  const params = []
  const matches = path.matchAll(routeParamRegex)
  for (const match of matches) {
    params.push(match[1])
  }
  return params
}

const normalizeRouteKey = (route) => `${route.method} /api${route.path}`

const matchesRouteFilter = (route, filter) => {
  if (!filter) {
    return true
  }
  const normalizedFilter = filter.includes('/api') ? filter : filter.replace(/^\s*(\w+)\s+/, '$1 /api')
  const normalizedRoute = normalizeRouteKey(route)
  return normalizedRoute.toLowerCase() === normalizedFilter.trim().toLowerCase()
}

const toSnake = (value) =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/\W+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase()

const buildToken = () => crypto.randomUUID()

const waitForUrl = async (url, timeoutMs = 120000) => {
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

const readLogTail = (file, maxChars = 4000) => {
  try {
    const content = readFileSync(file, 'utf8')
    return content.length > maxChars ? content.slice(-maxChars) : content
  } catch {
    return ''
  }
}

const spawnServer = (command, args, options) =>
  spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options })

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

const createAdminClient = async () => {
  const client = new Client({ connectionString: adminDbUrl })
  await client.connect()
  return client
}

const databaseExists = async (client, name) => {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])
  return result.rows.length > 0
}

const dropDatabase = async (client, name) => {
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()',
    [name]
  )
  await client.query(`DROP DATABASE IF EXISTS ${name}`)
}

const createDatabaseFromTemplate = async (client, name, template) => {
  await dropDatabase(client, name)
  await client.query(`CREATE DATABASE ${name} TEMPLATE ${template}`)
}

const createLegacyTemplateDatabase = async (admin, name) => {
  await dropDatabase(admin, name)
  await admin.query(`CREATE DATABASE ${name}`)
  const client = await createDbClient(name)
  await applyLegacyMigrations(client)
  await client.end()
}

const createDbClient = async (dbName) => {
  const url = adminDbUrl.replace(/\/[^/]+$/, `/${dbName}`)
  const client = new Client({ connectionString: url })
  await client.connect()
  return client
}

const selectSingleValue = async (client, query, params = []) => {
  const result = await client.query(query, params)
  if (!result.rows.length) {
    return null
  }
  const first = result.rows[0]
  return Object.values(first)[0]
}

const ensureEnumValue = async (client, table, column, value) => {
  await client.query(`INSERT INTO ${table} (${column}) VALUES ($1) ON CONFLICT (${column}) DO NOTHING`, [value])
}

const ensureReferenceData = async (client) => {
  const insertMany = async (table, column, values) => {
    const exists = await selectSingleValue(client, 'SELECT to_regclass($1) IS NOT NULL', [`public.${table}`])
    if (!exists) {
      return
    }
    for (const value of values) {
      await ensureEnumValue(client, table, column, value)
    }
  }

  await insertMany('brand_color', 'id', ['blue', 'green', 'red', 'yellow', 'orange', 'purple'])
  await insertMany('client_status', 'status', ['current', 'past', 'lead'])
  await insertMany('payment_status', 'status', ['paid', 'rejected', 'requested', 'refunded', 'pending'])
  await insertMany('payment_plan_status', 'status', ['active', 'paused', 'pending', 'cancelled', 'ended'])
  await insertMany('payment_plan_payment_status', 'status', [
    'paid',
    'rejected',
    'refunded',
    'cancelled',
    'paused',
    'pending',
  ])
  await insertMany('payment_method', 'method', ['cash', 'card'])
  await insertMany('client_session_state', 'state', [
    'maybe',
    'cancelled',
    'invited',
    'confirmed',
    'accepted',
    'declined',
  ])
  await insertMany('booking_payment_type', 'type', ['hidePrice', 'noPrepayment', 'fullPrepayment'])
  await insertMany('booking_question_state', 'state', ['optional', 'required'])
  await insertMany('request_client_address_online_type', 'type', ['optional', 'required'])
  await insertMany('mail_bounce_type', 'type', ['hard', 'soft'])
  await insertMany('client_appointment_reminder_type', 'type', ['email', 'sms'])
  await insertMany('service_provider_appointment_reminder_type', 'type', [
    'email',
    'notification',
    'emailAndNotification',
  ])
}

const createTrainer = async (client, label) => {
  await ensureReferenceData(client)
  let countryId = await selectSingleValue(client, 'SELECT country_id FROM supported_country_currency LIMIT 1')
  countryId ??= await selectSingleValue(client, 'SELECT id FROM country LIMIT 1')
  const fixtureIds = FIXTURE_IDS[label]
  const userId = fixtureIds?.trainerUserId ?? crypto.randomUUID()
  const trainerId = fixtureIds?.trainerId ?? crypto.randomUUID()
  const trainerEmail = `codex_trainer_${label.toLowerCase()}@example.com`
  await client.query("INSERT INTO user_ (id, type) VALUES ($1, 'trainer') ON CONFLICT (id, type) DO NOTHING", [userId])
  await client.query(
    `INSERT INTO trainer (id, user_id, user_type, country_id, email, password_hash, first_name, timezone, locale, eligible_for_grandfather, terms_accepted)
     VALUES ($1, $2, 'trainer', $3, $4, crypt('password', '$2a$10$1234567890123456789012'), $5, 'UTC', 'en', false, true)
     ON CONFLICT (id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         country_id = EXCLUDED.country_id,
         email = EXCLUDED.email,
         first_name = EXCLUDED.first_name,
         locale = EXCLUDED.locale,
         timezone = EXCLUDED.timezone,
         terms_accepted = EXCLUDED.terms_accepted`,
    [trainerId, userId, countryId, trainerEmail, `Trainer ${label}`]
  )
  const hasTaxTable = await selectSingleValue(client, "SELECT to_regclass('public.tax') IS NOT NULL")
  if (hasTaxTable) {
    const existingCount = await selectSingleValue(client, 'SELECT count(*)::int FROM tax WHERE trainer_id = $1', [
      trainerId,
    ])
    const needed = Math.max(0, 3 - (existingCount ?? 0))
    if (needed > 0) {
      const values = Array.from({ length: needed }, () => '($1)').join(', ')
      await client.query(`INSERT INTO tax (trainer_id) VALUES ${values}`, [trainerId])
    }
  }
  const calendarSlug = `calendar_slug_${label.toLowerCase()}`
  const smsCheckoutId = `sms_checkout_${label.toLowerCase()}`
  const pageUrlSlug = `page_slug_${label.toLowerCase()}`
  await client.query(
    `UPDATE trainer
        SET icalendar_url_slug = $1,
            sms_credit_checkout_id = $2,
            online_bookings_page_url_slug = $3,
            created_at = $4,
            updated_at = $4
      WHERE id = $5`,
    [calendarSlug, smsCheckoutId, pageUrlSlug, SAMPLE_DATETIME, trainerId]
  )
  const accountTableExists = await selectSingleValue(client, "SELECT to_regclass('stripe.account') IS NOT NULL")
  if (accountTableExists) {
    const stripeAccountId = `acct_codex_${label.toLowerCase()}`
    const bankAccountId = `ba_codex_${label.toLowerCase()}`
    const accountObject = {
      id: stripeAccountId,
      object: 'account',
      type: 'standard',
      charges_enabled: false,
      payouts_enabled: false,
      default_currency: 'usd',
      external_accounts: {
        data: [
          {
            id: bankAccountId,
            object: 'bank_account',
            account: stripeAccountId,
            country: 'US',
            currency: 'usd',
            last4: '6789',
            status: 'new',
            fingerprint: null,
            routing_number: null,
            account_holder_name: null,
            account_holder_type: 'individual',
            account_type: null,
            bank_name: 'Mock Bank',
            default_for_currency: true,
            available_payout_methods: ['standard'],
          },
        ],
      },
      requirements: {
        current_deadline: null,
        currently_due: [],
        disabled_reason: null,
        errors: null,
        eventually_due: [],
        past_due: [],
        pending_verification: [],
      },
    }
    await client.query(
      `INSERT INTO stripe.account (id, api_version, object)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET object = EXCLUDED.object`,
      [stripeAccountId, '2020-08-27', JSON.stringify(accountObject)]
    )
    const balanceTableExists = await selectSingleValue(
      client,
      "SELECT to_regclass('public.stripe_balance') IS NOT NULL"
    )
    if (balanceTableExists) {
      const balanceObject = {
        object: 'balance',
        available: [{ amount: 0, currency: 'usd' }],
        pending: [{ amount: 0, currency: 'usd' }],
      }
      await client.query(
        `INSERT INTO stripe_balance (account_id, api_version, object)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE
         SET object = EXCLUDED.object`,
        [stripeAccountId, '2020-08-27', JSON.stringify(balanceObject)]
      )
    }
    await client.query('UPDATE trainer SET stripe_account_id = $1 WHERE id = $2', [stripeAccountId, trainerId])
  }
  return { trainerId, trainerUserId: userId, trainerEmail }
}

const createClient = async (client, trainerId, label) => {
  await ensureReferenceData(client)
  const fixtureIds = FIXTURE_IDS[label]
  const userId = fixtureIds?.clientUserId ?? crypto.randomUUID()
  const clientId = fixtureIds?.clientId ?? crypto.randomUUID()
  const clientEmail = `codex_client_${label.toLowerCase()}@example.com`
  await client.query("INSERT INTO user_ (id, type) VALUES ($1, 'client') ON CONFLICT (id, type) DO NOTHING", [userId])
  await client.query(
    `INSERT INTO client (id, user_id, user_type, first_name, status, trainer_id, email)
     VALUES ($1, $2, 'client', $3, 'current', $4, $5)
     ON CONFLICT (id, trainer_id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         email = EXCLUDED.email,
         first_name = EXCLUDED.first_name,
         status = EXCLUDED.status`,
    [clientId, userId, `Client ${label}`, trainerId, clientEmail]
  )
  return { clientId, clientUserId: userId, clientTrainerId: trainerId, clientEmail }
}

const ensureTrainerAndClient = async (client, label) => {
  const trainer = await createTrainer(client, label)
  const clientRow = await createClient(client, trainer.trainerId, label)
  return {
    ...trainer,
    ...clientRow,
  }
}

const insertAccessToken = async (client, tokenId, userId, userType, tokenType, expiresAtInterval = '30 days') => {
  await client.query(
    `INSERT INTO access_token (id, user_id, user_type, expires_at, type)
     VALUES ($1, $2, $3, NOW() + interval '${expiresAtInterval}', $4)
     ON CONFLICT (id, type) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         user_type = EXCLUDED.user_type,
         expires_at = EXCLUDED.expires_at`,
    [tokenId, userId, userType, tokenType]
  )
}

const getTables = async (client) => {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  )
  return new Set(result.rows.map((row) => row.table_name))
}

const ensureSchemaHistoryTable = async (client) => {
  const result = await client.query("SELECT to_regclass('public.schema_history') is not null as exists")
  if (result.rows[0]?.exists) {
    return
  }
  await client.query(`CREATE TABLE schema_history(
    installed_rank int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    version text UNIQUE,
    description text NOT NULL,
    type text NOT NULL,
    script text NOT NULL UNIQUE,
    checksum uuid,
    installed_by text,
    installed_on timestamptz NOT NULL DEFAULT now(),
    execution_time int NOT NULL,
    success bool NOT NULL
  );`)
}

const applyLegacyMigrations = async (client) => {
  const migrations = listLegacyMigrations()
  for (const migration of migrations) {
    if (migration.type !== 'sql') {
      continue
    }
    let content = awaitReadFile(migration.fullPath)
    if (migration.file === 'V55__Notification_foreign_keys_should_cascade.sql') {
      content = `
ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_client_id_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (id) ON DELETE CASCADE;

ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_payment_plan_id_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES payment_plan (id) ON DELETE CASCADE;

ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_payment_id_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payment (id) ON DELETE CASCADE;

ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_payment_plan_payment_id_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_payment_plan_payment_id_fkey FOREIGN KEY (payment_plan_payment_id) REFERENCES payment_plan_payment (id) ON DELETE CASCADE;

ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_session_pack_id_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_session_pack_id_fkey FOREIGN KEY (session_pack_id) REFERENCES session_pack (id) ON DELETE CASCADE;

ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_user_id_fkey;
ALTER TABLE app_notification DROP CONSTRAINT IF EXISTS app_notification_user_id_user_type_fkey;
ALTER TABLE app_notification ADD CONSTRAINT app_notification_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES user_ (id, type) ON DELETE CASCADE;
`
    }
    if (migration.file === 'V68__Cascade_deletes_for_sessions.sql') {
      content = `
ALTER TABLE session DROP CONSTRAINT IF EXISTS session_session_series_id_fkey;
ALTER TABLE session ADD CONSTRAINT session_session_series_id_fkey FOREIGN KEY (session_series_id) REFERENCES session_series (id) ON DELETE CASCADE;

ALTER TABLE session_series DROP CONSTRAINT IF EXISTS session_series_trainer_id_fkey;
ALTER TABLE session_series ADD CONSTRAINT session_series_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES trainer (id) ON DELETE CASCADE;

ALTER TABLE tax DROP CONSTRAINT IF EXISTS tax_trainer_id_fkey;
ALTER TABLE tax ADD CONSTRAINT tax_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES trainer (id) ON DELETE CASCADE;

ALTER TABLE trainer DROP CONSTRAINT IF EXISTS trainer_user_id_fkey;
ALTER TABLE trainer DROP CONSTRAINT IF EXISTS trainer_user_id_user_type_fkey;
ALTER TABLE trainer ADD CONSTRAINT trainer_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES user_ (id, type) ON DELETE CASCADE;

CREATE INDEX ON tax (trainer_id);
`
    }
    if (migration.file === 'V25__Cascade_delete_client_session_session.sql') {
      content = `
ALTER TABLE client_session DROP CONSTRAINT IF EXISTS client_session_session_id_fkey;
ALTER TABLE client_session ADD CONSTRAINT client_session_session_id_fkey FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE;
`
    }
    if (migration.file === 'V82__Fix_foreign_keys_for_deleting_clients.sql') {
      content = `
ALTER TABLE client_session DROP CONSTRAINT IF EXISTS client_session_client_id_fkey;
ALTER TABLE client_session ADD CONSTRAINT client_session_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (id) ON DELETE CASCADE;

ALTER TABLE payment DROP CONSTRAINT IF EXISTS payment_client_id_fkey;
ALTER TABLE payment ADD CONSTRAINT payment_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (id) ON DELETE CASCADE;

ALTER TABLE payment_plan DROP CONSTRAINT IF EXISTS payment_plan_client_id_fkey;
ALTER TABLE payment_plan ADD CONSTRAINT payment_plan_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES trainer_client (client_id, trainer_id) ON DELETE CASCADE;

ALTER TABLE session_pack DROP CONSTRAINT IF EXISTS session_pack_client_id_fkey;
ALTER TABLE session_pack ADD CONSTRAINT session_pack_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES trainer_client (client_id, trainer_id) ON DELETE CASCADE;

ALTER TABLE payment_plan_acceptance DROP CONSTRAINT IF EXISTS payment_plan_acceptance_payment_plan_id_fkey;
ALTER TABLE payment_plan_acceptance ADD CONSTRAINT payment_plan_acceptance_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES payment_plan (id) ON DELETE CASCADE;

ALTER TABLE payment_plan_payment DROP CONSTRAINT IF EXISTS payment_plan_payment_payment_plan_id_fkey;
ALTER TABLE payment_plan_payment ADD CONSTRAINT payment_plan_payment_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES payment_plan (id) ON DELETE CASCADE;

ALTER TABLE payment_plan_pause DROP CONSTRAINT IF EXISTS payment_plan_pause_payment_plan_id_fkey;
ALTER TABLE payment_plan_pause ADD CONSTRAINT payment_plan_pause_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES payment_plan (id) ON DELETE CASCADE;

ALTER TABLE payment_plan_charge DROP CONSTRAINT IF EXISTS payment_plan_charge_payment_plan_payment_id_fkey;
ALTER TABLE payment_plan_charge ADD CONSTRAINT payment_plan_charge_payment_plan_payment_id_fkey FOREIGN KEY (payment_plan_payment_id) REFERENCES payment_plan_payment (id) ON DELETE CASCADE;
`
    }
    if (migration.file === 'V137__Create_sales_table.sql') {
      content = content.replaceAll(/DROP\s+CONSTRAINT\s+(?!IF\s+EXISTS)([^;]+);/gi, 'DROP CONSTRAINT IF EXISTS $1;')
    }
    if (migration.file === 'V165__Remove_sale_ordered_product.sql') {
      content = content.replace(
        /DROP\s+TABLE\s+sale_ordered_product\s*;/i,
        'DROP TABLE IF EXISTS sale_ordered_product CASCADE;'
      )
    }
    content = content.replaceAll(/DROP\s+CONSTRAINT\s+(?!IF\s+EXISTS)([^;]+);/gi, 'DROP CONSTRAINT IF EXISTS $1;')
    try {
      await client.query(content)
    } catch (error) {
      console.error(`Failed to apply legacy migration ${migration.file}`, error)
      throw error
    }
  }
}

const markMigrationsApplied = async (client) => {
  await ensureSchemaHistoryTable(client)
  const count = await client.query('SELECT count(*)::int as count FROM schema_history')
  if ((count.rows[0]?.count ?? 0) > 0) {
    return
  }

  const migrations = listLegacyMigrations()
  for (const migration of migrations) {
    const type = migration.type.toUpperCase()
    const content = awaitReadFile(migration.fullPath)
    const checksum = crypto.createHash('md5').update(content).digest('hex')
    await client.query(
      `INSERT INTO schema_history (
        version,
        description,
        type,
        script,
        checksum,
        installed_by,
        execution_time,
        success
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (script) DO NOTHING`,
      [migration.version, migration.description, type, migration.file, checksum, process.env.USER ?? 'codex', 0, true]
    )
  }
}

const overrideValueForKey = (key, state) => {
  if (!key) {
    return undefined
  }
  if (state?.ids?.[key]) {
    return state.ids[key]
  }
  if (key === 'trainerId') {
    return state?.ids?.trainerId
  }
  if (key === 'clientId') {
    return state?.ids?.clientId
  }
  if (key === 'userId') {
    return state?.trainerUserId ?? state?.clientUserId
  }
  if (key === 'email') {
    return state?.trainerEmail ?? state?.clientEmail ?? SAMPLE_EMAIL
  }
  if (key === 'password') {
    return 'password'
  }
  if (key === 'currentPassword') {
    return 'password'
  }
  if (key === 'newPassword') {
    return 'newpassword'
  }
  return undefined
}

const applyOverridesToValue = (value, state) => {
  if (Array.isArray(value)) {
    return value.map((entry) => applyOverridesToValue(entry, state))
  }
  if (value && typeof value === 'object') {
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      const override = overrideValueForKey(key, state)
      output[key] = override !== undefined ? override : applyOverridesToValue(entry, state)
    }
    return output
  }
  return value
}

const makeWrongType = (value) => {
  if (Array.isArray(value)) {
    return 'invalid'
  }
  if (value === null || value === undefined) {
    return 'invalid'
  }
  if (typeof value === 'string') {
    return 1
  }
  if (typeof value === 'number') {
    return 'invalid'
  }
  if (typeof value === 'boolean') {
    return 'invalid'
  }
  if (typeof value === 'object') {
    return 'invalid'
  }
  return 'invalid'
}

const buildQueryString = (query) => {
  if (!query || typeof query !== 'object') {
    return ''
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)))
    } else if (typeof value === 'object') {
      params.set(key, JSON.stringify(value))
    } else {
      params.set(key, String(value))
    }
  }
  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

const buildMultipartBody = ({ fields, fileField, fileName, mimeType, fileContent }) => {
  const boundary = `----codex-${crypto.randomUUID()}`
  const lines = []
  const appendField = (name, value) => {
    lines.push(`--${boundary}`)
    lines.push(`Content-Disposition: form-data; name="${name}"`)
    lines.push('')
    lines.push(String(value))
  }
  const appendFile = (name, filename, contentType, content) => {
    lines.push(`--${boundary}`)
    lines.push(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`)
    lines.push(`Content-Type: ${contentType}`)
    lines.push('')
    lines.push(content)
  }
  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue
      }
      appendField(key, value)
    }
  }
  if (fileContent !== null && fileContent !== undefined) {
    appendFile(fileField, fileName, mimeType, fileContent)
  }
  lines.push(`--${boundary}--`)
  const body = lines.join('\r\n')
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

const resolveParamValue = async ({ param, route, client, tables, state }) => {
  if (state?.ids?.[param]) {
    return state.ids[param]
  }
  if (param === 'userId' && state?.trainerUserId) {
    return state.trainerUserId
  }
  if (param === 'memberId' && state?.trainerUserId) {
    return state.trainerUserId
  }
  if (param === 'imageUrl') {
    return 'test.jpg'
  }
  if (param === 'pageUrlSlug') {
    const value = await selectSingleValue(client, 'SELECT online_bookings_page_url_slug FROM trainer LIMIT 1')
    return value ?? 'test'
  }
  if (param === 'id') {
    if (route.startsWith('/icalendar')) {
      const value = await selectSingleValue(client, 'SELECT icalendar_url_slug FROM trainer LIMIT 1')
      return value ?? 'test'
    }
    if (route.startsWith('/smsCreditCheckouts')) {
      if (tables.has('sms_credit_checkout')) {
        const value = await selectSingleValue(client, 'SELECT id FROM sms_credit_checkout LIMIT 1')
        return value ?? crypto.randomUUID()
      }
      return crypto.randomUUID()
    }
    if (route.startsWith('/smsCreditCheckoutSessions')) {
      if (tables.has('sms_credit_checkout_session')) {
        const value = await selectSingleValue(client, 'SELECT id FROM sms_credit_checkout_session LIMIT 1')
        return value ?? crypto.randomUUID()
      }
      return crypto.randomUUID()
    }
  }

  const aliasMap = {
    saleProductId: 'ordered_product',
    planId: 'payment_plan',
    paymentPlanId: 'payment_plan',
    paymentPlanPaymentId: 'payment_plan_payment',
    sessionSeriesId: 'session_series',
    sessionId: 'session',
    clientSessionId: 'client_session',
    financeItemId: 'finance_item',
    rewardId: 'reward',
    saleId: 'sale',
    paymentId: 'payment',
    productId: 'product',
    invitationId: 'session_invitation',
    bookingId: 'online_booking',
  }

  const table = aliasMap[param] ?? toSnake(param.replace(/Id$/, ''))
  if (tables.has(table)) {
    const value = await selectSingleValue(client, `SELECT id FROM ${table} LIMIT 1`)
    return value ?? crypto.randomUUID()
  }

  return crypto.randomUUID()
}

const BODY_OVERRIDES = [
  {
    method: 'POST',
    path: '/members/login',
    build: (state) => ({
      email: state?.trainerEmail ?? SAMPLE_EMAIL,
      password: 'password',
    }),
  },
  {
    method: 'POST',
    path: '/members/reset',
    build: (state) => ({
      email: state?.trainerEmail ?? SAMPLE_EMAIL,
    }),
  },
  {
    method: 'POST',
    path: '/members/password',
    build: () => ({
      currentPassword: 'password',
      password: 'newpassword',
    }),
  },
  {
    method: 'POST',
    path: '/members/:userId/password',
    build: () => ({ password: 'password' }),
  },
  {
    method: 'POST',
    path: '/appStoreServerNotifications',
    build: (_state, env) => ({
      password: env.APP_STORE_SHARED_SECRET ?? 'mock',
      environment: 'Sandbox',
    }),
  },
  {
    method: 'POST',
    path: '/appStoreReceipts',
    build: (_state, env) => ({
      password: env.APP_STORE_SHARED_SECRET ?? 'mock',
      receiptData: 'test',
    }),
  },
]

const getBodyOverride = (route, method, state, env) => {
  for (const override of BODY_OVERRIDES) {
    if (override.method !== method) {
      continue
    }
    if (override.path === route) {
      return override.build(state, env)
    }
  }
  return null
}

const buildRequestBody = (route, method, state, baseUrl, env, bodySample, scenario, multipartFields) => {
  if (!METHOD_HAS_BODY.has(method)) {
    return null
  }

  if (route === '/mandrillEvents') {
    const events = JSON.stringify([{ event: 'test', _id: 'evt_1', ts: Date.now() }])
    return { type: 'form', body: `mandrill_events=${encodeURIComponent(events)}` }
  }

  if (route === '/twilioStatusMessage') {
    return { type: 'form', body: 'MessageSid=SM123' }
  }

  if (route === '/stripeEvents') {
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'account.updated',
      data: { object: {} },
    })
    const secret = env.STRIPE_WEBHOOK_SECRET ?? 'whsec_mock'
    const signatureMode = scenario?.signatureMode
    let stripeSignature = computeStripeSignature({ secret, payload })
    if (signatureMode === 'invalid') {
      stripeSignature = 'bad'
    }
    if (signatureMode === 'expired') {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 86400
      stripeSignature = computeStripeSignature({ secret, payload, timestamp: oldTimestamp })
    }
    const extraHeaders = signatureMode === 'missing' ? {} : { 'stripe-signature': stripeSignature }
    return { type: 'raw', body: payload, extraHeaders }
  }

  const overrideBody = getBodyOverride(route, method, state, env)
  const baseBody = overrideBody ?? bodySample ?? {}
  const hydrated = applyOverridesToValue(baseBody, state)

  if (scenario?.bodyMode === 'multipart') {
    const fieldPath = scenario?.multipartField ?? multipartFields?.[0]
    const fieldKey = Array.isArray(fieldPath) ? fieldPath[0] : fieldPath
    const fileField = fieldKey ? String(fieldKey) : 'file'
    const multipartMode = scenario?.multipartMode ?? 'valid'
    const fields = hydrated && typeof hydrated === 'object' && !Array.isArray(hydrated) ? { ...hydrated } : {}
    delete fields[fileField]
    const useField = multipartMode === 'wrong_field' ? `${fileField}_wrong` : fileField
    let fileContent = 'test'
    if (multipartMode === 'missing') {
      fileContent = null
    }
    if (multipartMode === 'empty') {
      fileContent = ''
    }
    const mimeType = multipartMode === 'wrong_mime' ? 'text/plain' : 'image/png'
    const fileName = multipartMode === 'wrong_mime' ? 'test.txt' : 'test.png'
    const { body, contentType } = buildMultipartBody({
      fields,
      fileField: useField,
      fileName,
      mimeType,
      fileContent,
    })
    return { type: 'multipart', body, contentType }
  }

  if (scenario?.bodyMode === 'none') {
    return null
  }
  if (scenario?.bodyMode === 'empty') {
    return { type: 'json', body: JSON.stringify({}) }
  }
  if (scenario?.bodyMode === 'invalid') {
    return { type: 'raw', body: '"invalid"' }
  }
  if (scenario?.bodyMode === 'missing_key' && scenario?.bodyKey) {
    if (hydrated && typeof hydrated === 'object' && !Array.isArray(hydrated)) {
      const copy = { ...hydrated }
      delete copy[scenario.bodyKey]
      return { type: 'json', body: JSON.stringify(copy) }
    }
  }
  if (scenario?.bodyMode === 'wrong_type' && scenario?.bodyKey) {
    if (hydrated && typeof hydrated === 'object' && !Array.isArray(hydrated)) {
      const copy = { ...hydrated }
      copy[scenario.bodyKey] = makeWrongType(copy[scenario.bodyKey])
      return { type: 'json', body: JSON.stringify(copy) }
    }
  }
  if (scenario?.bodyMode === 'invalid_time_range' && scenario.bodyStartPath && scenario.bodyEndPath) {
    if (hydrated && typeof hydrated === 'object') {
      const copy = cloneValue(hydrated)
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const startApplied = setValueByPath(copy, scenario.bodyStartPath, future)
      const endApplied = setValueByPath(copy, scenario.bodyEndPath, past)
      if (startApplied && endApplied) {
        return { type: 'json', body: JSON.stringify(copy) }
      }
    }
  }
  if (scenario?.bodyMode === 'invalid_id') {
    const targetPath = scenario.bodyPath ?? (scenario.bodyKey ? [scenario.bodyKey] : null)
    if (targetPath && hydrated && typeof hydrated === 'object') {
      const copy = cloneValue(hydrated)
      const applied = setValueByPath(copy, targetPath, 'not-a-uuid')
      if (applied) {
        return { type: 'json', body: JSON.stringify(copy) }
      }
    }
  }
  if (scenario?.bodyMode === 'negative') {
    const targetPath = scenario.bodyPath ?? (scenario.bodyKey ? [scenario.bodyKey] : null)
    if (targetPath && hydrated && typeof hydrated === 'object') {
      const copy = cloneValue(hydrated)
      const applied = setValueByPath(copy, targetPath, -1)
      if (applied) {
        return { type: 'json', body: JSON.stringify(copy) }
      }
    }
  }

  return { type: 'json', body: JSON.stringify(hydrated) }
}

const computeMandrillSignature = ({ baseUrl, formBody }) => {
  const url = new URL('/api/mandrillEvents', baseUrl).toString()
  const params = new URLSearchParams(formBody)
  const sortedEntries = [...params.entries()].toSorted(([a], [b]) => a.localeCompare(b))
  const signedData = url + sortedEntries.map(([key, value]) => key + value).join('')
  const hmac = crypto.createHmac('sha1', 'mock-auth-key')
  hmac.update(signedData)
  return hmac.digest('base64')
}

const computeTwilioSignature = ({ authToken, url, formBody }) => {
  let signedUrl = url
  try {
    const parsed = new URL(url)
    parsed.protocol = 'https:'
    signedUrl = parsed.toString()
  } catch {
    // ignore
  }
  const params = new URLSearchParams(formBody)
  const sortedEntries = [...params.entries()].toSorted(([a], [b]) => a.localeCompare(b))
  const data = signedUrl + sortedEntries.map(([key, value]) => key + value).join('')
  return crypto.createHmac('sha1', authToken).update(data).digest('base64')
}

const computeStripeSignature = ({ secret, payload, timestamp }) => {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const signedPayload = `${ts}.${payload}`
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${ts},v1=${signature}`
}

const snapshotTables = async (client, tables) => {
  const result = {}
  for (const table of tables) {
    const { rows } = await client.query(`SELECT count(*)::int as count FROM ${table}`)
    result[table] = rows[0]?.count ?? 0
  }
  return result
}

const diffSnapshots = (before, after) => {
  const diff = {}
  for (const table of Object.keys(before)) {
    if (before[table] !== after[table]) {
      diff[table] = { before: before[table], after: after[table] }
    }
  }
  return diff
}

const snapshotRowById = async (client, table, id) => {
  if (!table || !id) {
    return null
  }
  const result = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
  return result.rows[0] ?? null
}

const restoreRow = async (client, table, row) => {
  if (!row || !table) {
    return
  }
  const columns = Object.keys(row).filter((col) => col !== 'id')
  if (!columns.length) {
    return
  }
  const setClauses = columns.map((col, idx) => `${col} = $${idx + 2}`).join(', ')
  const values = columns.map((col) => row[col])
  await client.query(`UPDATE ${table} SET ${setClauses} WHERE id = $1`, [row.id, ...values])
}

const upsertRow = async (client, table, row, conflictColumns = ['id']) => {
  if (!row || !table) {
    return
  }
  const columns = Object.keys(row)
  if (!columns.length) {
    return
  }
  const columnList = columns.join(', ')
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
  const updateColumns = columns.filter((col) => !conflictColumns.includes(col))
  const updateClause = updateColumns.length ? updateColumns.map((col) => `${col} = EXCLUDED.${col}`).join(', ') : ''
  const conflictTarget = conflictColumns.join(', ')
  const values = columns.map((col) => row[col])
  const query = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})
    ON CONFLICT (${conflictTarget}) DO ${updateClause ? `UPDATE SET ${updateClause}` : 'NOTHING'}`
  await client.query(query, values)
}

const diffRow = (beforeRow, afterRow) => {
  const before = beforeRow ? normalizeResponseValue(beforeRow, { sortArrays: true }) : null
  const after = afterRow ? normalizeResponseValue(afterRow, { sortArrays: true }) : null
  if (!before && !after) {
    return {}
  }
  const ignoredKeys = new Set(['password_hash'])
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const diff = {}
  for (const key of keys) {
    if (ignoredKeys.has(key)) {
      continue
    }
    const beforeValue = before?.[key]
    const afterValue = after?.[key]
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      diff[key] = { before: beforeValue ?? null, after: afterValue ?? null }
    }
  }
  return diff
}

const tablesForRoute = (route, tables) => {
  const segment = route.split('/').filter(Boolean)[1]
  if (!segment) {
    return []
  }
  const snake = toSnake(segment)
  const extras = {
    saleProducts: ['ordered_product', 'sale', 'sale_ordered_product'],
    salePayments: ['payment', 'sale'],
    sales: ['sale'],
    plans: ['payment_plan', 'payment_plan_payment', 'payment_plan_pause'],
    paymentPlans: ['payment_plan', 'payment_plan_payment'],
    sessionSeries: ['session_series'],
    sessions: ['session', 'client_session'],
    clientSessions: ['client_session'],
    financeItems: ['finance_item', 'finance_item_note'],
    clientNotes: ['client'],
    clients: ['client'],
    trainers: ['trainer'],
    rewards: ['reward'],
    products: ['product'],
    busyTimes: ['busy_time'],
  }
  if (extras[segment]) {
    return extras[segment].filter((table) => tables.has(table))
  }
  if (tables.has(snake)) {
    return [snake]
  }
  return []
}

const SIDE_EFFECT_TABLES = [
  'job',
  'jobs',
  'audit',
  'audit_log',
  'notification',
  'notification_message',
  'email',
  'email_log',
  'sms',
  'sms_log',
  'mail_queue',
  'outbox',
]

const tableColumnsCache = new Map()
const tableMetaCache = new Map()
const fkCache = new Map()

const getTableColumns = async (client, table) => {
  if (tableColumnsCache.has(table)) {
    return tableColumnsCache.get(table)
  }
  const result = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    ['public', table]
  )
  const columns = new Set(result.rows.map((row) => row.column_name))
  tableColumnsCache.set(table, columns)
  return columns
}

const getTableMetadata = async (client, table) => {
  if (tableMetaCache.has(table)) {
    return tableMetaCache.get(table)
  }
  const columns = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )
  const fkRows = await client.query(
    `SELECT
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND tc.table_name = $1`,
    [table]
  )
  const fks = new Map()
  for (const row of fkRows.rows) {
    fks.set(row.column_name, {
      table: row.foreign_table_name,
      column: row.foreign_column_name,
    })
  }
  const meta = { columns: columns.rows, fks }
  tableMetaCache.set(table, meta)
  return meta
}

const getEnumValues = async (client, udtName) => {
  const result = await client.query(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
     WHERE pg_type.typname = $1`,
    [udtName]
  )
  return result.rows.map((row) => row.enumlabel)
}

const getTableRowCount = async (client, table) => {
  const result = await client.query(`SELECT count(*)::int as count FROM ${table}`)
  return result.rows[0]?.count ?? 0
}

const getDistinctValues = async (client, table, column, limit = 50) => {
  const result = await client.query(
    `SELECT DISTINCT ${column} as value FROM ${table} WHERE ${column} IS NOT NULL LIMIT ${limit}`
  )
  return result.rows.map((row) => row.value)
}

const STATEFUL_COLUMN_RE = /(status|state|type|mode|phase|color|reminder|subscription|payment|plan)/i
const TIME_COLUMN_RE = /(start|end|expire|expires|due|cancel|cancelled|canceled|scheduled|trial|booking|paid|refund)/i
const SKIP_STATE_COLUMN_RE =
  /^(user_id|user_type|trainer_id|client_id|owner_id|email|password_hash|first_name|last_name|created_at|updated_at)$/i

const buildStateVariants = async (client, table) => {
  if (!table) {
    return []
  }
  if (table === 'user_') {
    return []
  }
  const meta = await getTableMetadata(client, table)
  const variants = []
  for (const column of meta.columns) {
    const name = column.column_name
    const dataType = column.data_type
    const udtName = column.udt_name
    const isNullable = column.is_nullable === 'YES'

    if (name === 'id' || name.endsWith('_id') || SKIP_STATE_COLUMN_RE.test(name)) {
      continue
    }

    const fk = meta.fks.get(name)
    if (fk && STATEFUL_COLUMN_RE.test(fk.table)) {
      const rowCount = await getTableRowCount(client, fk.table)
      if (rowCount > 0 && rowCount <= 30) {
        const values = await getDistinctValues(client, fk.table, fk.column, 50)
        for (const value of values) {
          variants.push({ column: name, value, label: `state.${name}=${value}` })
        }
      }
      continue
    }

    if (dataType === 'boolean') {
      variants.push({ column: name, value: true, label: `state.${name}=true` })
      variants.push({ column: name, value: false, label: `state.${name}=false` })
      continue
    }

    if (dataType === 'USER-DEFINED') {
      const values = await getEnumValues(client, udtName)
      for (const value of values) {
        variants.push({ column: name, value, label: `state.${name}=${value}` })
      }
      continue
    }

    if (
      STATEFUL_COLUMN_RE.test(name) &&
      (dataType.includes('character') || dataType === 'text' || dataType === 'citext')
    ) {
      const values = await getDistinctValues(client, table, name, 20)
      for (const value of values) {
        variants.push({ column: name, value, label: `state.${name}=${value}` })
      }
      continue
    }

    if (TIME_COLUMN_RE.test(name) && (dataType.startsWith('timestamp') || dataType === 'date')) {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      variants.push({
        column: name,
        value: dataType === 'date' ? past.toISOString().slice(0, 10) : past.toISOString(),
        label: `state.${name}=past`,
      })
      variants.push({
        column: name,
        value: dataType === 'date' ? future.toISOString().slice(0, 10) : future.toISOString(),
        label: `state.${name}=future`,
      })
      if (isNullable) {
        variants.push({ column: name, value: null, label: `state.${name}=null` })
      }
      continue
    }
  }
  return variants
}

const buildCompositeStateVariants = async (client, table) => {
  const variants = []
  if (table === 'payment') {
    variants.push({
      label: 'state.payment=paid',
      updatesFn: (row) => ({
        status: 'paid',
        amount_refunded: 0,
        paid_date: row.paid_date ?? new Date().toISOString(),
      }),
    })
    variants.push({
      label: 'state.payment=refunded_full',
      updatesFn: (row) => ({
        status: 'refunded',
        amount_refunded: row.amount ?? 0,
      }),
    })
    variants.push({
      label: 'state.payment=refunded_partial',
      updatesFn: (row) => ({
        status: 'refunded',
        amount_refunded: row.amount ? Number(row.amount) / 2 : 0,
      }),
    })
    variants.push({
      label: 'state.payment=pending',
      updatesFn: () => ({
        status: 'pending',
        paid_date: null,
      }),
    })
  }

  if (table === 'payment_plan') {
    variants.push({
      label: 'state.plan=accepted',
      updatesFn: (row) => ({
        status: 'active',
        accepted_amount: row.amount ?? null,
        accepted_end: row.end_ ?? null,
      }),
    })
    variants.push({
      label: 'state.plan=unaccepted',
      updatesFn: () => ({
        status: 'pending',
        accepted_amount: null,
        accepted_end: null,
      }),
    })
    variants.push({
      label: 'state.plan=paused',
      updatesFn: () => ({
        status: 'paused',
      }),
      setup: async (client, id, row) => {
        const pauseId = crypto.randomUUID()
        await client.query(
          `INSERT INTO payment_plan_pause (id, payment_plan_id, trainer_id, start, end_) VALUES ($1, $2, $3, NOW(), NOW() + interval '7 days')`,
          [pauseId, id, row?.trainer_id ?? null]
        )
        return async () => {
          await client.query(`DELETE FROM payment_plan_pause WHERE id = $1`, [pauseId])
        }
      },
    })
  }

  if (table === 'payment_plan_payment') {
    variants.push({
      label: 'state.plan_payment=paid',
      updatesFn: (row) => ({
        status: 'paid',
        amount_outstanding: 0,
        retry_count: row.retry_count ?? 0,
      }),
    })
    variants.push({
      label: 'state.plan_payment=pending',
      updatesFn: (row) => ({
        status: 'pending',
        amount_outstanding: row.amount ?? row.amount_outstanding ?? 0,
      }),
    })
    variants.push({
      label: 'state.plan_payment=refunded',
      updatesFn: () => ({
        status: 'refunded',
        amount_outstanding: 0,
      }),
    })
  }

  if (table === 'client_session') {
    variants.push({
      label: 'state.client_session=cancelled',
      updatesFn: () => ({
        state: 'cancelled',
        cancel_time: new Date().toISOString(),
      }),
    })
    variants.push({
      label: 'state.client_session=invited',
      updatesFn: () => ({
        state: 'invited',
        invite_time: new Date().toISOString(),
      }),
    })
  }

  if (table === 'session') {
    variants.push({
      label: 'state.session=past',
      updatesFn: (row) => ({
        start: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        duration: row.duration ?? '01:00:00',
      }),
    })
    variants.push({
      label: 'state.session=future',
      updatesFn: (row) => ({
        start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        duration: row.duration ?? '01:00:00',
      }),
    })
  }

  return variants
}

const applyDbVariant = async (client, table, id, variant) => {
  if (!variant || !table || !id) {
    return { applied: false, restore: async () => {} }
  }
  const rowResult = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
  const originalRow = rowResult.rows[0]
  if (!originalRow) {
    return { applied: false, restore: async () => {} }
  }

  let updates = {}
  if (variant.updatesFn) {
    updates = variant.updatesFn(originalRow)
  } else if (variant.updates) {
    updates = variant.updates
  } else if (variant.column) {
    updates = { [variant.column]: variant.value }
  }

  const columns = Object.keys(updates)
  if (!columns.length) {
    return { applied: false, restore: async () => {} }
  }

  const values = columns.map((col) => updates[col])
  const setClauses = columns.map((col, idx) => `${col} = $${idx + 2}`).join(', ')

  let extraCleanup = async () => {}
  if (variant.setup) {
    try {
      extraCleanup = (await variant.setup(client, id, originalRow)) ?? (async () => {})
    } catch {
      return { applied: false, restore: async () => {} }
    }
  }

  try {
    await client.query(`UPDATE ${table} SET ${setClauses} WHERE id = $1`, [id, ...values])
    return {
      applied: true,
      restore: async () => {
        const restoreColumns = columns.map((col) => originalRow[col])
        await client.query(`UPDATE ${table} SET ${setClauses} WHERE id = $1`, [id, ...restoreColumns])
        await extraCleanup()
      },
    }
  } catch {
    await extraCleanup()
    return { applied: false, restore: async () => {} }
  }
}

const selectLatestId = async (client, table) => {
  if (!table) {
    return null
  }
  const columns = await getTableColumns(client, table)
  if (!columns.has('id')) {
    return null
  }
  let orderBy = 'id'
  if (columns.has('created_at')) {
    orderBy = 'created_at'
  } else if (columns.has('updated_at')) {
    orderBy = 'updated_at'
  }
  const result = await client.query(`SELECT id FROM ${table} ORDER BY ${orderBy} DESC LIMIT 1`)
  return result.rows[0]?.id ?? null
}

const extractIdFromResponse = (value) => {
  if (!value) {
    return null
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractIdFromResponse(entry)
      if (found) {
        return found
      }
    }
    return null
  }
  if (typeof value === 'object') {
    if (typeof value.id === 'string') {
      return value.id
    }
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' && /id$/i.test(key)) {
        return entry
      }
    }
    for (const entry of Object.values(value)) {
      const found = extractIdFromResponse(entry)
      if (found) {
        return found
      }
    }
  }
  return null
}

const looksLikeUuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const looksLikeIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)

const shouldStripKey = (key) =>
  /(^id$|_id$|Id$|createdAt$|updatedAt$|deletedAt$|token$|accessToken$|refreshToken$|password$)/.test(key)

const normalizeResponseValue = (value, options = {}) => {
  const { sortArrays = true } = options
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeResponseValue(entry, options))
    if (sortArrays) {
      normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    return normalized
  }
  if (value && typeof value === 'object') {
    const output = {}
    const keys = Object.keys(value).toSorted()
    for (const key of keys) {
      const entry = value[key]
      if (shouldStripKey(key)) {
        continue
      }
      output[key] = normalizeResponseValue(entry, options)
    }
    return output
  }
  if (looksLikeUuid(value)) {
    return '<uuid>'
  }
  if (looksLikeIsoDate(value)) {
    return '<date>'
  }
  return value
}

const normalizeErrorShape = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeErrorShape(entry))
  }
  if (value && typeof value === 'object') {
    const output = {}
    const keys = Object.keys(value).toSorted()
    for (const key of keys) {
      const entry = value[key]
      if (shouldStripKey(key)) {
        continue
      }
      output[key] = normalizeErrorShape(entry)
    }
    return output
  }
  if (value === null) {
    return 'null'
  }
  return typeof value
}

const parseResponse = async (res) => {
  if (!res || typeof res.status === 'string') {
    return { status: res?.status ?? 'ERR', body: null, text: await res?.text?.(), contentType: '' }
  }
  const contentType = res.headers?.get?.('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = await res.json()
      return { status: res.status, body, text: null, contentType }
    } catch {
      const text = await res.text()
      return { status: res.status, body: null, text, contentType }
    }
  }
  const text = await res.text()
  return { status: res.status, body: null, text, contentType }
}

const executeRoute = async ({ route, state, client, tables, baseUrl, env, authHeader, scenario }) => {
  const params = normalizePathParams(route.path)
  let resolvedPath = route.path
  for (const param of params) {
    const overrideValue = scenario?.paramOverrides?.[param]
    const value =
      overrideValue !== undefined
        ? overrideValue
        : await resolveParamValue({ param, route: route.path, client, tables, state })
    resolvedPath = resolvedPath.replace(`:${param}`, encodeURIComponent(String(value)))
  }

  let querySample = route.querySample ? applyOverridesToValue(route.querySample, state) : null
  if (scenario?.queryOverrides) {
    if (!querySample || typeof querySample !== 'object') {
      querySample = {}
    }
    querySample = { ...querySample, ...scenario.queryOverrides }
  }
  if (scenario?.queryMode === 'missing') {
    querySample = null
  } else if (scenario?.queryMode === 'invalid') {
    querySample = {}
    if (route.queryRequiredKeys?.length) {
      for (const key of route.queryRequiredKeys) {
        querySample[key] = 'invalid'
      }
    } else if (route.querySample && typeof route.querySample === 'object') {
      for (const key of Object.keys(route.querySample)) {
        querySample[key] = 'invalid'
      }
    } else {
      querySample.invalid = 'invalid'
    }
  } else if (scenario?.queryMode === 'invalid_id') {
    const targetPath = scenario.queryPath ?? (scenario.queryKey ? [scenario.queryKey] : null)
    if (!querySample || typeof querySample !== 'object') {
      querySample = {}
    }
    if (targetPath) {
      const copy = cloneValue(querySample)
      const applied = setValueByPath(copy, targetPath, 'not-a-uuid')
      if (applied) {
        querySample = copy
      }
    }
  } else if (scenario?.queryMode === 'negative') {
    const targetPath = scenario.queryPath ?? (scenario.queryKey ? [scenario.queryKey] : null)
    if (!querySample || typeof querySample !== 'object') {
      querySample = {}
    }
    if (targetPath) {
      const copy = cloneValue(querySample)
      const applied = setValueByPath(copy, targetPath, -1)
      if (applied) {
        querySample = copy
      }
    }
  } else if (scenario?.queryMode === 'invalid_time_range') {
    const startPath = scenario.queryStartPath
    const endPath = scenario.queryEndPath
    if (!querySample || typeof querySample !== 'object') {
      querySample = {}
    }
    if (startPath && endPath) {
      const copy = cloneValue(querySample)
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const startApplied = setValueByPath(copy, startPath, future)
      const endApplied = setValueByPath(copy, endPath, past)
      if (startApplied && endApplied) {
        querySample = copy
      }
    }
  }
  const queryString = buildQueryString(querySample)
  const url = `${baseUrl}/api${resolvedPath}${queryString}`

  const bodyInfo = buildRequestBody(
    route.path,
    route.method,
    state,
    baseUrl,
    env,
    route.bodySample,
    scenario,
    route.multipartFields
  )
  const headers = {}
  if (authHeader) {
    headers.Authorization = authHeader
  }

  if (bodyInfo?.type === 'json' || bodyInfo?.type === 'raw') {
    headers['content-type'] = 'application/json'
  } else if (bodyInfo?.type === 'form') {
    headers['content-type'] = 'application/x-www-form-urlencoded'
  } else if (bodyInfo?.type === 'multipart') {
    headers['content-type'] = bodyInfo.contentType
  }

  if (bodyInfo?.extraHeaders) {
    Object.assign(headers, bodyInfo.extraHeaders)
  }

  if (route.path === '/mandrillEvents' && bodyInfo?.type === 'form') {
    if (scenario?.signatureMode !== 'missing') {
      const signature = computeMandrillSignature({ baseUrl, formBody: bodyInfo.body })
      headers['x-mandrill-signature'] = scenario?.signatureMode === 'invalid' ? 'bad' : signature
    }
  }

  if (route.path === '/twilioStatusMessage' && bodyInfo?.type === 'form') {
    if (scenario?.signatureMode !== 'missing') {
      const signatureBase = env.BASE_URL ?? baseUrl
      const signature = computeTwilioSignature({
        authToken: env.TWILIO_AUTH_TOKEN ?? '',
        url: new URL('/api/twilioStatusMessage', signatureBase).toString(),
        formBody: bodyInfo.body,
      })
      headers['x-twilio-signature'] = scenario?.signatureMode === 'invalid' ? 'bad' : signature
    }
  }

  const init = {
    method: route.method,
    headers,
    body: bodyInfo?.body ?? undefined,
  }

  let res
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      res = await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    const isTimeout = error?.name === 'AbortError'
    const message = isTimeout ? `Timeout after ${REQUEST_TIMEOUT_MS}ms` : String(error)
    if (isTimeout) {
      console.warn(`Timeout ${route.method} ${url}`)
    }
    res = { status: isTimeout ? 'TIMEOUT' : 'ERR', ok: false, text: async () => message }
  }
  const parsed = await parseResponse(res)
  return { res, parsed, url, resolvedPath }
}

const SEED_ROUTES = [
  { method: 'POST', path: '/trainers/:trainerId/clients', idKey: 'clientId', table: 'client' },
  { method: 'POST', path: '/products', idKey: 'productId', table: 'product' },
  { method: 'POST', path: '/session-series', idKey: 'sessionSeriesId', table: 'session_series' },
  { method: 'POST', path: '/bookings', idKey: 'sessionId', table: 'session' },
  { method: 'POST', path: '/sessions/:sessionId/clients', idKey: 'clientSessionId', table: 'client_session' },
  { method: 'POST', path: '/sales', idKey: 'saleId', table: 'sale' },
  { method: 'POST', path: '/sale-products', idKey: 'saleProductId', table: 'ordered_product' },
  { method: 'POST', path: '/sale-payments', idKey: 'paymentId', table: 'payment' },
  { method: 'POST', path: '/clients/:clientId/plans', idKey: 'planId', table: 'payment_plan' },
  { method: 'POST', path: '/session-invitations', idKey: 'invitationId', table: 'session_invitation' },
  { method: 'POST', path: '/trainers/:trainerId/financeItems', idKey: 'financeItemId', table: 'finance_item' },
]

const seedResources = async ({ routesByKey, state, client, tables, baseUrl, env, authHeader, force = false }) => {
  for (const seed of SEED_ROUTES) {
    if (!force && state.ids[seed.idKey]) {
      continue
    }
    const route = routesByKey.get(`${seed.method} ${seed.path}`)
    if (!route) {
      continue
    }
    const { parsed } = await executeRoute({
      route,
      state,
      client,
      tables,
      baseUrl,
      env,
      authHeader,
      scenario: { bodyMode: 'valid', queryMode: 'valid' },
    })
    if (typeof parsed.status === 'number' && parsed.status >= 200 && parsed.status < 300) {
      const extracted = extractIdFromResponse(parsed.body)
      const fallback = extracted ? null : await selectLatestId(client, seed.table)
      const id = extracted ?? fallback
      if (id) {
        state.ids[seed.idKey] = id
      }
    }
  }
}

const buildAuthHeader = (route, scenario, tokens) => {
  if (!route.security) {
    return null
  }
  const authMode = scenario.authMode ?? AUTH_VALID
  if (authMode === AUTH_NONE) {
    return null
  }
  if (authMode === AUTH_INVALID) {
    return 'Bearer invalid'
  }

  const isServiceProvider = route.security === 'serviceProvider' || route.security === 'serviceProviderOrClient'

  if (authMode === AUTH_EXPIRED) {
    return isServiceProvider ? `Bearer ${tokens.trainerExpired}` : `Bearer ${tokens.clientExpired}`
  }

  if (authMode === AUTH_WRONG_TYPE) {
    if (route.security === 'client') {
      return `Bearer ${tokens.trainerA}`
    }
    return `Bearer ${tokens.clientA}`
  }

  if (route.security === 'serviceProviderOrClient' && scenario.authMode === AUTH_VALID && scenario.useClientToken) {
    return `Bearer ${tokens.clientA}`
  }

  if (isServiceProvider) {
    return `Bearer ${tokens.trainerA}`
  }
  return `Bearer ${tokens.clientA}`
}

const buildParamOverrides = (route, mode, state) => {
  if (mode !== 'not_found' && mode !== 'invalid') {
    return null
  }
  const overrides = {}
  const params = normalizePathParams(route.path)
  for (const param of params) {
    const lower = param.toLowerCase()
    if (mode === 'invalid') {
      if (lower.includes('slug')) {
        overrides[param] = '!!!'
      } else if (lower.includes('url')) {
        overrides[param] = 'not-a-url'
      } else if (lower.includes('id')) {
        overrides[param] = 'not-a-uuid'
      } else {
        overrides[param] = 'invalid'
      }
      continue
    }
    if (lower.includes('slug')) {
      overrides[param] = 'missing-slug'
    } else if (lower.includes('url')) {
      overrides[param] = 'missing-url'
    } else {
      overrides[param] = crypto.randomUUID()
    }
  }
  return overrides
}

const shouldForceSeed = (route, scenario) => {
  if (METHOD_MUTATES.has(route.method)) {
    return true
  }
  if (scenario?.actionRepeat) {
    return true
  }
  if (scenario?.repeatCount && scenario.repeatCount > 1) {
    return true
  }
  if (route.method === 'DELETE') {
    return true
  }
  if (scenario?.paramMode === 'not_found') {
    return true
  }
  return false
}

const ensureAccessTokens = async (client, bindings, tokens) => {
  await insertAccessToken(client, tokens.trainerA, bindings.trainerA, 'trainer', 'api')
  await insertAccessToken(client, tokens.trainerB, bindings.trainerB, 'trainer', 'api')
  await insertAccessToken(client, tokens.clientA, bindings.clientA, 'client', 'client_dashboard')
  await insertAccessToken(client, tokens.clientB, bindings.clientB, 'client', 'client_dashboard')
  await insertAccessToken(client, tokens.trainerExpired, bindings.trainerA, 'trainer', 'api', '-1 day')
  await insertAccessToken(client, tokens.clientExpired, bindings.clientA, 'client', 'client_dashboard', '-1 day')
}

const PARAM_TABLE_MAP = {
  saleProductId: 'ordered_product',
  planId: 'payment_plan',
  paymentPlanId: 'payment_plan',
  paymentPlanPaymentId: 'payment_plan_payment',
  sessionSeriesId: 'session_series',
  sessionId: 'session',
  clientSessionId: 'client_session',
  financeItemId: 'finance_item',
  financeItem: 'finance_item',
  rewardId: 'reward',
  saleId: 'sale',
  paymentId: 'payment',
  productId: 'product',
  invitationId: 'session_invitation',
  bookingId: 'online_booking',
  clientId: 'client',
  trainerId: 'trainer',
  noteId: 'client_note',
  memberId: 'user_',
  userId: 'user_',
}

const SEGMENT_TABLE_MAP = {
  saleProducts: 'ordered_product',
  salePayments: 'payment',
  sales: 'sale',
  plans: 'payment_plan',
  paymentPlans: 'payment_plan',
  sessionSeries: 'session_series',
  sessions: 'session',
  clientSessions: 'client_session',
  financeItems: 'finance_item',
  clientNotes: 'client_note',
  clients: 'client',
  trainers: 'trainer',
  rewards: 'reward',
  products: 'product',
  busyTimes: 'busy_time',
  bookings: 'online_booking',
}

const getPrimaryResource = (route, tables) => {
  const params = normalizePathParams(route.path)
  for (const param of params) {
    const table = PARAM_TABLE_MAP[param] ?? toSnake(param.replace(/Id$/, ''))
    if (tables.has(table)) {
      return { table, idParam: param }
    }
  }
  const segment = route.path.split('/').filter(Boolean)[0]
  if (segment) {
    const table = SEGMENT_TABLE_MAP[segment] ?? toSnake(segment)
    if (tables.has(table)) {
      return { table, idParam: null }
    }
  }
  return { table: null, idParam: null }
}

const getResourceId = async (client, state, idParam, table) => {
  if (idParam && state?.ids?.[idParam]) {
    return state.ids[idParam]
  }
  if (table) {
    const latest = await selectLatestId(client, table)
    if (latest) {
      return latest
    }
  }
  return null
}

const resolvePrimaryId = async (client, state, table) => {
  if (!table) {
    return null
  }
  if (state?.ids) {
    if (table === 'trainer' && state.ids.trainerId) {
      return state.ids.trainerId
    }
    if (table === 'client' && state.ids.clientId) {
      return state.ids.clientId
    }
  }
  return selectLatestId(client, table)
}

const buildScenariosForRoute = (route) => {
  const scenarios = []
  const scenarioNames = new Set()
  const isBody = METHOD_HAS_BODY.has(route.method)
  const hasQuery =
    route.querySample &&
    typeof route.querySample === 'object' &&
    !Array.isArray(route.querySample) &&
    Object.keys(route.querySample).length > 0
  const hasParams = normalizePathParams(route.path).length > 0
  const isListRoute = route.method === 'GET' && !hasParams
  const queryKeys =
    route.querySample && typeof route.querySample === 'object' && !Array.isArray(route.querySample)
      ? Object.keys(route.querySample)
      : []
  const pathLooksMultipart = /(upload|image|photo|avatar|file|document|attachment)/i.test(route.path)
  const isMultipartRoute = (route.multipartFields?.length ?? 0) > 0 || pathLooksMultipart
  const defaultBodyMode = isBody ? (isMultipartRoute ? 'multipart' : 'valid') : 'none'

  const addScenario = (scenario) => {
    if (scenarioNames.has(scenario.name)) {
      return
    }
    scenarioNames.add(scenario.name)
    scenarios.push({
      name: scenario.name,
      authMode: scenario.authMode ?? AUTH_VALID,
      useClientToken: scenario.useClientToken ?? false,
      stateMode: scenario.stateMode ?? 'primary',
      bodyMode: scenario.bodyMode ?? defaultBodyMode,
      bodyKey: scenario.bodyKey,
      bodyPath: scenario.bodyPath,
      bodyStartPath: scenario.bodyStartPath,
      bodyEndPath: scenario.bodyEndPath,
      multipartMode: scenario.multipartMode,
      multipartField: scenario.multipartField,
      queryMode: scenario.queryMode ?? (hasQuery ? 'valid' : 'none'),
      queryKey: scenario.queryKey,
      queryPath: scenario.queryPath,
      queryStartPath: scenario.queryStartPath,
      queryEndPath: scenario.queryEndPath,
      queryOverrides: scenario.queryOverrides,
      paramMode: scenario.paramMode ?? (hasParams ? 'valid' : 'none'),
      signatureMode: scenario.signatureMode,
      actionRepeat: scenario.actionRepeat ?? false,
      repeatCount: scenario.repeatCount,
    })
  }

  addScenario({ name: 'ok' })

  if (route.security) {
    addScenario({ name: 'auth.none', authMode: AUTH_NONE })
    addScenario({ name: 'auth.invalid', authMode: AUTH_INVALID })
    addScenario({ name: 'auth.expired', authMode: AUTH_EXPIRED })
    addScenario({ name: 'auth.wrongType', authMode: AUTH_WRONG_TYPE })
    addScenario({ name: 'auth.otherOwner', authMode: AUTH_OTHER_OWNER, stateMode: 'other' })

    if (route.security === 'serviceProviderOrClient') {
      addScenario({ name: 'ok.clientToken', useClientToken: true })
    }
  }

  if (hasParams) {
    addScenario({ name: 'params.notFound', paramMode: 'not_found' })
    addScenario({ name: 'params.invalid', paramMode: 'invalid' })
  }

  if (hasQuery) {
    addScenario({ name: 'query.missing', queryMode: 'missing' })
    addScenario({ name: 'query.invalid', queryMode: 'invalid' })
    if (route.queryIdPaths?.length) {
      for (const path of route.queryIdPaths) {
        addScenario({
          name: `query.invalidId.${formatPath(path)}`,
          queryMode: 'invalid_id',
          queryPath: path,
        })
      }
    }
    if (route.queryNumericPaths?.length) {
      for (const path of route.queryNumericPaths) {
        addScenario({
          name: `query.negative.${formatPath(path)}`,
          queryMode: 'negative',
          queryPath: path,
        })
      }
    }

    if (route.queryTimeRangePairs?.length) {
      for (const pair of route.queryTimeRangePairs) {
        addScenario({
          name: `query.time.invalidRange.${formatPath(pair.startPath)}`,
          queryMode: 'invalid_time_range',
          queryStartPath: pair.startPath,
          queryEndPath: pair.endPath,
        })
      }
    }
  }

  if (isBody) {
    addScenario({ name: 'body.empty', bodyMode: 'empty' })
    addScenario({ name: 'body.invalidType', bodyMode: 'invalid' })

    if (route.bodyRequiredKeys?.length) {
      for (const key of route.bodyRequiredKeys) {
        addScenario({ name: `body.missing.${key}`, bodyMode: 'missing_key', bodyKey: key })
        addScenario({ name: `body.wrongType.${key}`, bodyMode: 'wrong_type', bodyKey: key })
      }
    }

    if (route.bodyIdPaths?.length) {
      for (const path of route.bodyIdPaths) {
        addScenario({
          name: `body.invalidId.${formatPath(path)}`,
          bodyMode: 'invalid_id',
          bodyPath: path,
        })
      }
    }

    if (route.bodyNumericPaths?.length) {
      for (const path of route.bodyNumericPaths) {
        addScenario({
          name: `body.negative.${formatPath(path)}`,
          bodyMode: 'negative',
          bodyPath: path,
        })
      }
    }

    if (route.bodyTimeRangePairs?.length) {
      for (const pair of route.bodyTimeRangePairs) {
        addScenario({
          name: `body.time.invalidRange.${formatPath(pair.startPath)}`,
          bodyMode: 'invalid_time_range',
          bodyStartPath: pair.startPath,
          bodyEndPath: pair.endPath,
        })
      }
    }

    const pathLooksMultipart = /(upload|image|photo|avatar|file|document|attachment)/i.test(route.path)
    if ((route.multipartFields?.length ?? 0) > 0 || pathLooksMultipart) {
      const fieldPath = route.multipartFields?.[0]
      addScenario({
        name: 'body.multipart.valid',
        bodyMode: 'multipart',
        multipartMode: 'valid',
        multipartField: fieldPath,
      })
      addScenario({
        name: 'body.multipart.missingFile',
        bodyMode: 'multipart',
        multipartMode: 'missing',
        multipartField: fieldPath,
      })
      addScenario({
        name: 'body.multipart.wrongField',
        bodyMode: 'multipart',
        multipartMode: 'wrong_field',
        multipartField: fieldPath,
      })
      addScenario({
        name: 'body.multipart.emptyFile',
        bodyMode: 'multipart',
        multipartMode: 'empty',
        multipartField: fieldPath,
      })
      addScenario({
        name: 'body.multipart.wrongMime',
        bodyMode: 'multipart',
        multipartMode: 'wrong_mime',
        multipartField: fieldPath,
      })
    }
  }

  if (['/mandrillEvents', '/twilioStatusMessage', '/stripeEvents'].includes(route.path)) {
    addScenario({ name: 'signature.invalid', signatureMode: 'invalid' })
    addScenario({ name: 'signature.missing', signatureMode: 'missing' })
    if (route.path === '/stripeEvents') {
      addScenario({ name: 'signature.expired', signatureMode: 'expired' })
    }
    addScenario({ name: 'webhook.repeat', repeatCount: 2 })
  }

  const actionKeywords = [
    'cancel',
    'refund',
    'accept',
    'retry',
    'pause',
    'unpause',
    'invite',
    'confirm',
    'share',
    'logout',
    'reset',
    'delete',
  ]
  const isActionRoute =
    route.method === 'DELETE' || actionKeywords.some((keyword) => route.path.toLowerCase().includes(keyword))
  if (isActionRoute) {
    addScenario({ name: 'action.repeat', actionRepeat: true })
  }

  const isCreateRoute = route.method === 'POST' && !isActionRoute
  if (isCreateRoute) {
    addScenario({ name: 'repeat.create', repeatCount: 2 })
  }

  const addQueryOverrideScenario = (name, overrides) => {
    addScenario({ name, queryMode: 'valid', queryOverrides: overrides })
  }

  if (hasQuery || isListRoute) {
    const limitKeys = ['limit', 'pageSize', 'page_size', 'perPage', 'per_page']
    const offsetKeys = ['offset']
    const pageKeys = ['page']
    const sortKeys = ['sort', 'sortBy', 'orderBy']
    const orderKeys = ['order', 'direction']

    const keysToUse = (keys, fallback) =>
      keys.filter((key) => queryKeys.includes(key)).concat(queryKeys.length ? [] : fallback)

    for (const key of keysToUse(limitKeys, isListRoute ? ['limit'] : [])) {
      addQueryOverrideScenario(`query.${key}.zero`, { [key]: 0 })
      addQueryOverrideScenario(`query.${key}.negative`, { [key]: -1 })
      addQueryOverrideScenario(`query.${key}.large`, { [key]: 10000 })
    }
    for (const key of keysToUse(pageKeys, isListRoute ? ['page'] : [])) {
      addQueryOverrideScenario(`query.${key}.zero`, { [key]: 0 })
      addQueryOverrideScenario(`query.${key}.negative`, { [key]: -1 })
      addQueryOverrideScenario(`query.${key}.large`, { [key]: 9999 })
    }
    for (const key of keysToUse(offsetKeys, isListRoute ? ['offset'] : [])) {
      addQueryOverrideScenario(`query.${key}.negative`, { [key]: -1 })
      addQueryOverrideScenario(`query.${key}.large`, { [key]: 9999 })
    }
    for (const key of sortKeys.filter((k) => queryKeys.includes(k))) {
      addQueryOverrideScenario(`query.${key}.invalid`, { [key]: '__invalid__' })
    }
    for (const key of orderKeys.filter((k) => queryKeys.includes(k))) {
      addQueryOverrideScenario(`query.${key}.invalid`, { [key]: 'sideways' })
    }
  }

  return scenarios
}

const run = async () => {
  const admin = await createAdminClient()
  const timestamp = Date.now()
  const legacyDb = `keepon_api_legacy_${timestamp}`
  const newDb = `keepon_api_new_${timestamp}`
  const fallbackTemplateDb = `keepon_api_template_${timestamp}`
  const logDir = path.join(os.tmpdir(), `keepon-api-diff-${timestamp}`)
  const legacyLog = path.join(logDir, 'legacy.log')
  const newLog = path.join(logDir, 'new.log')
  let legacyProc
  let newProc
  let legacyDbClient
  let newDbClient
  let dbsCreated = false
  let templateDbName = templateDb
  let templateCreated = false

  try {
    mkdirSync(logDir, { recursive: true })
    const legacyPort = await resolvePort(desiredLegacyPort, 'Legacy')
    const newPort = await resolvePort(desiredNewPort, 'New', new Set([legacyPort]))
    const templateExists = await databaseExists(admin, templateDb)
    if (templateExists) {
      const templateClient = await createDbClient(templateDb)
      const hasTaxTable = await selectSingleValue(templateClient, "SELECT to_regclass('public.tax') IS NOT NULL")
      await templateClient.end()
      if (!hasTaxTable) {
        templateDbName = fallbackTemplateDb
        templateCreated = true
        await createLegacyTemplateDatabase(admin, templateDbName)
      }
    } else {
      templateDbName = fallbackTemplateDb
      templateCreated = true
      await createLegacyTemplateDatabase(admin, templateDbName)
    }

    await createDatabaseFromTemplate(admin, legacyDb, templateDbName)
    await createDatabaseFromTemplate(admin, newDb, templateDbName)
    dbsCreated = true

    legacyDbClient = await createDbClient(legacyDb)
    newDbClient = await createDbClient(newDb)

    await markMigrationsApplied(legacyDbClient)

    const fixtureA = await ensureTrainerAndClient(legacyDbClient, 'A')
    const fixtureB = await ensureTrainerAndClient(legacyDbClient, 'B')
    const fixtureNewA = await ensureTrainerAndClient(newDbClient, 'A')
    const fixtureNewB = await ensureTrainerAndClient(newDbClient, 'B')

    const tokensLegacy = {
      trainerA: buildToken(),
      trainerB: buildToken(),
      clientA: buildToken(),
      clientB: buildToken(),
      trainerExpired: buildToken(),
      clientExpired: buildToken(),
    }

    const tokensNew = {
      trainerA: tokensLegacy.trainerA,
      trainerB: tokensLegacy.trainerB,
      clientA: tokensLegacy.clientA,
      clientB: tokensLegacy.clientB,
      trainerExpired: tokensLegacy.trainerExpired,
      clientExpired: tokensLegacy.clientExpired,
    }

    const legacyBindings = {
      trainerA: fixtureA.trainerUserId,
      trainerB: fixtureB.trainerUserId,
      clientA: fixtureA.clientUserId,
      clientB: fixtureB.clientUserId,
    }

    const newBindings = {
      trainerA: fixtureNewA.trainerUserId,
      trainerB: fixtureNewB.trainerUserId,
      clientA: fixtureNewA.clientUserId,
      clientB: fixtureNewB.clientUserId,
    }

    await ensureAccessTokens(legacyDbClient, legacyBindings, tokensLegacy)
    await ensureAccessTokens(newDbClient, newBindings, tokensNew)

    const tablesLegacy = await getTables(legacyDbClient)
    const tablesNew = await getTables(newDbClient)

    const stateLegacyA = {
      ids: {
        trainerId: fixtureA.trainerId,
        clientId: fixtureA.clientId,
      },
      trainerUserId: fixtureA.trainerUserId,
      clientUserId: fixtureA.clientUserId,
      trainerEmail: fixtureA.trainerEmail,
      clientEmail: fixtureA.clientEmail,
    }

    const stateLegacyB = {
      ids: {
        trainerId: fixtureB.trainerId,
        clientId: fixtureB.clientId,
      },
      trainerUserId: fixtureB.trainerUserId,
      clientUserId: fixtureB.clientUserId,
      trainerEmail: fixtureB.trainerEmail,
      clientEmail: fixtureB.clientEmail,
    }

    const stateNewA = {
      ids: {
        trainerId: fixtureNewA.trainerId,
        clientId: fixtureNewA.clientId,
      },
      trainerUserId: fixtureNewA.trainerUserId,
      clientUserId: fixtureNewA.clientUserId,
      trainerEmail: fixtureNewA.trainerEmail,
      clientEmail: fixtureNewA.clientEmail,
    }

    const stateNewB = {
      ids: {
        trainerId: fixtureNewB.trainerId,
        clientId: fixtureNewB.clientId,
      },
      trainerUserId: fixtureNewB.trainerUserId,
      clientUserId: fixtureNewB.clientUserId,
      trainerEmail: fixtureNewB.trainerEmail,
      clientEmail: fixtureNewB.clientEmail,
    }

    const baselineLegacy = {
      trainerA: await snapshotRowById(legacyDbClient, 'trainer', fixtureA.trainerId),
      trainerB: await snapshotRowById(legacyDbClient, 'trainer', fixtureB.trainerId),
      clientA: await snapshotRowById(legacyDbClient, 'client', fixtureA.clientId),
      clientB: await snapshotRowById(legacyDbClient, 'client', fixtureB.clientId),
      trainerUserA: await snapshotRowById(legacyDbClient, 'user_', fixtureA.trainerUserId),
      trainerUserB: await snapshotRowById(legacyDbClient, 'user_', fixtureB.trainerUserId),
      clientUserA: await snapshotRowById(legacyDbClient, 'user_', fixtureA.clientUserId),
      clientUserB: await snapshotRowById(legacyDbClient, 'user_', fixtureB.clientUserId),
    }

    const baselineNew = {
      trainerA: await snapshotRowById(newDbClient, 'trainer', fixtureNewA.trainerId),
      trainerB: await snapshotRowById(newDbClient, 'trainer', fixtureNewB.trainerId),
      clientA: await snapshotRowById(newDbClient, 'client', fixtureNewA.clientId),
      clientB: await snapshotRowById(newDbClient, 'client', fixtureNewB.clientId),
      trainerUserA: await snapshotRowById(newDbClient, 'user_', fixtureNewA.trainerUserId),
      trainerUserB: await snapshotRowById(newDbClient, 'user_', fixtureNewB.trainerUserId),
      clientUserA: await snapshotRowById(newDbClient, 'user_', fixtureNewA.clientUserId),
      clientUserB: await snapshotRowById(newDbClient, 'user_', fixtureNewB.clientUserId),
    }

    const sharedBaseUrl = `http://localhost:${newPort}`
    const legacyRequestBaseUrl = `http://localhost:${legacyPort}`
    const newRequestBaseUrl = `http://localhost:${newPort}`

    const legacyEnv = {
      ...process.env,
      PGHOST: 'localhost',
      PGPORT: '5432',
      PGUSER: 'postgres',
      PGPASSWORD: 'postgres',
      PGDATABASE: legacyDb,
      PORT: String(legacyPort),
      BASE_URL: sharedBaseUrl,
      STRIPE_API_KEY: 'sk_test_mock',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
      GOOGLE_PUBLISHABLE_KEY: 'google-pub-mock',
      GOOGLE_API_KEY: 'google-api-mock',
      APPLE_CLIENT_ID: 'apple-client-mock',
      STRIPE_WEBHOOK_SECRET: 'whsec_mock',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_mock',
      MANDRILL_API_KEY: 'mock',
      TWILIO_ACCOUNT_SID: 'ACMOCK',
      TWILIO_AUTH_TOKEN: 'mock-token',
      APP_STORE_SHARED_SECRET: 'mock',
      PUBLIC_BUCKET_NAME: 'mock-public-bucket',
      TS_NODE_PROJECT: path.join(LEGACY_ROOT, 'tsconfig.json'),
      NODE_OPTIONS: `--require ${MOCK_EXTERNAL_PATH}`,
    }

    const newEnv = {
      ...process.env,
      DATABASE_URL: `postgres://postgres:postgres@localhost:5432/${newDb}`,
      DB_SSL: 'false',
      PORT: String(newPort),
      BASE_URL: sharedBaseUrl,
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
      GOOGLE_PUBLISHABLE_KEY: 'google-pub-mock',
      GOOGLE_API_KEY: 'google-api-mock',
      APPLE_CLIENT_ID: 'apple-client-mock',
      STRIPE_WEBHOOK_SECRET: 'whsec_mock',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_mock',
      MANDRILL_API_KEY: 'mock',
      TWILIO_ACCOUNT_SID: 'ACMOCK',
      TWILIO_AUTH_TOKEN: 'mock-token',
      APP_STORE_SHARED_SECRET: 'mock',
      PUBLIC_BUCKET_NAME: 'mock-public-bucket',
      NODE_OPTIONS: `--require ${MOCK_EXTERNAL_PATH}`,
    }

    legacyProc = spawnServer('node', ['-r', 'ts-node/register/transpile-only', '-r', 'dotenv/config', 'src/index.js'], {
      cwd: LEGACY_ROOT,
      env: legacyEnv,
    })

    newProc = spawnServer('pnpm', ['exec', 'next', 'dev', '--webpack', '-p', String(newPort)], {
      cwd: NEW_ROOT,
      env: newEnv,
    })

    const legacyLogStream = createWriteStream(legacyLog, { flags: 'a' })
    const newLogStream = createWriteStream(newLog, { flags: 'a' })
    legacyProc.stdout?.pipe(legacyLogStream)
    legacyProc.stderr?.pipe(legacyLogStream)
    newProc.stdout?.pipe(newLogStream)
    newProc.stderr?.pipe(newLogStream)

    const legacyReady = await waitForUrl(`http://localhost:${legacyPort}/api/config`)
    const newReady = await waitForUrl(`http://localhost:${newPort}/api/config`)

    if (!legacyReady || !newReady) {
      if (!legacyReady) {
        console.log('Legacy server log tail:')
        console.log(readLogTail(legacyLog))
      }
      if (!newReady) {
        console.log('New server log tail:')
        console.log(readLogTail(newLog))
      }
      throw new Error('Servers failed to start')
    }

    let routes = parseLegacyRoutes()
    if (filterRouteArg) {
      routes = routes.filter((route) => matchesRouteFilter(route, filterRouteArg))
    }
    const routesByKey = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]))

    await seedResources({
      routesByKey,
      state: stateLegacyA,
      client: legacyDbClient,
      tables: tablesLegacy,
      baseUrl: legacyRequestBaseUrl,
      env: legacyEnv,
      authHeader: `Bearer ${tokensLegacy.trainerA}`,
    })

    await seedResources({
      routesByKey,
      state: stateLegacyB,
      client: legacyDbClient,
      tables: tablesLegacy,
      baseUrl: legacyRequestBaseUrl,
      env: legacyEnv,
      authHeader: `Bearer ${tokensLegacy.trainerB}`,
    })

    await seedResources({
      routesByKey,
      state: stateNewA,
      client: newDbClient,
      tables: tablesNew,
      baseUrl: newRequestBaseUrl,
      env: newEnv,
      authHeader: `Bearer ${tokensNew.trainerA}`,
    })

    await seedResources({
      routesByKey,
      state: stateNewB,
      client: newDbClient,
      tables: tablesNew,
      baseUrl: newRequestBaseUrl,
      env: newEnv,
      authHeader: `Bearer ${tokensNew.trainerB}`,
    })

    const mismatches = []
    const bodyMismatches = []
    const dbMismatches = []
    const errorMismatches = []
    const orderMismatches = []
    const rowMismatches = []

    const outputDir = path.join(NEW_ROOT, 'history')
    mkdirSync(outputDir, { recursive: true })
    const outputPath = readArg('--output') ?? path.join(outputDir, `api-error-matrix-${timestamp}.json`)

    for (const route of routes) {
      if (resetFixtures) {
        await upsertRow(legacyDbClient, 'user_', baselineLegacy.trainerUserA, ['id', 'type'])
        await upsertRow(legacyDbClient, 'user_', baselineLegacy.trainerUserB, ['id', 'type'])
        await upsertRow(legacyDbClient, 'user_', baselineLegacy.clientUserA, ['id', 'type'])
        await upsertRow(legacyDbClient, 'user_', baselineLegacy.clientUserB, ['id', 'type'])
        await upsertRow(legacyDbClient, 'trainer', baselineLegacy.trainerA)
        await upsertRow(legacyDbClient, 'trainer', baselineLegacy.trainerB)
        await upsertRow(legacyDbClient, 'client', baselineLegacy.clientA, ['id', 'trainer_id'])
        await upsertRow(legacyDbClient, 'client', baselineLegacy.clientB, ['id', 'trainer_id'])

        await upsertRow(newDbClient, 'user_', baselineNew.trainerUserA, ['id', 'type'])
        await upsertRow(newDbClient, 'user_', baselineNew.trainerUserB, ['id', 'type'])
        await upsertRow(newDbClient, 'user_', baselineNew.clientUserA, ['id', 'type'])
        await upsertRow(newDbClient, 'user_', baselineNew.clientUserB, ['id', 'type'])
        await upsertRow(newDbClient, 'trainer', baselineNew.trainerA)
        await upsertRow(newDbClient, 'trainer', baselineNew.trainerB)
        await upsertRow(newDbClient, 'client', baselineNew.clientA, ['id', 'trainer_id'])
        await upsertRow(newDbClient, 'client', baselineNew.clientB, ['id', 'trainer_id'])
      }

      let scenarios = buildScenariosForRoute(route)
      if (filterScenarioArg) {
        scenarios = scenarios.filter((scenario) => scenario.name === filterScenarioArg)
      }
      const { table: primaryTable, idParam } = getPrimaryResource(route, tablesLegacy)
      const baseStateVariants = primaryTable ? await buildStateVariants(legacyDbClient, primaryTable) : []
      const compositeVariants = primaryTable ? await buildCompositeStateVariants(legacyDbClient, primaryTable) : []
      const stateVariants = [...baseStateVariants, ...compositeVariants]
      const actionKeywords = [
        'cancel',
        'refund',
        'accept',
        'retry',
        'pause',
        'unpause',
        'invite',
        'confirm',
        'share',
        'logout',
        'reset',
        'delete',
      ]
      const isActionRoute =
        route.method === 'DELETE' || actionKeywords.some((keyword) => route.path.toLowerCase().includes(keyword))
      const statePathLooksMultipart = /(upload|image|photo|avatar|file|document|attachment)/i.test(route.path)
      const stateMultipartRoute = (route.multipartFields?.length ?? 0) > 0 || statePathLooksMultipart
      const stateBodyMode = METHOD_HAS_BODY.has(route.method) ? (stateMultipartRoute ? 'multipart' : 'valid') : 'none'
      for (const variant of stateVariants) {
        scenarios.push({
          name: variant.label,
          authMode: AUTH_VALID,
          bodyMode: stateBodyMode,
          queryMode:
            route.querySample &&
            typeof route.querySample === 'object' &&
            !Array.isArray(route.querySample) &&
            Object.keys(route.querySample).length > 0
              ? 'valid'
              : 'none',
          paramMode: 'valid',
          stateMode: 'primary',
          dbVariant: variant,
          actionRepeat: isActionRoute,
        })
      }

      for (const scenario of scenarios) {
        if (showProgress) {
          const scenarioLabel = scenario?.name ? ` ${scenario.name}` : ''
          console.log(`${route.method} ${route.path}${scenarioLabel}`)
        }
        const isOther = scenario.stateMode === 'other'
        const legacyState = isOther ? stateLegacyB : stateLegacyA
        const newState = isOther ? stateNewB : stateNewA

        if (shouldForceSeed(route, scenario)) {
          const legacySeedAuth = isOther ? `Bearer ${tokensLegacy.trainerB}` : `Bearer ${tokensLegacy.trainerA}`
          const newSeedAuth = isOther ? `Bearer ${tokensNew.trainerB}` : `Bearer ${tokensNew.trainerA}`
          await seedResources({
            routesByKey,
            state: legacyState,
            client: legacyDbClient,
            tables: tablesLegacy,
            baseUrl: legacyRequestBaseUrl,
            env: legacyEnv,
            authHeader: legacySeedAuth,
            force: true,
          })
          await seedResources({
            routesByKey,
            state: newState,
            client: newDbClient,
            tables: tablesNew,
            baseUrl: newRequestBaseUrl,
            env: newEnv,
            authHeader: newSeedAuth,
            force: true,
          })
        }

        await ensureAccessTokens(legacyDbClient, legacyBindings, tokensLegacy)
        await ensureAccessTokens(newDbClient, newBindings, tokensNew)

        const authHeaderLegacy = buildAuthHeader(route, scenario, tokensLegacy)
        const authHeaderNew = buildAuthHeader(route, scenario, tokensNew)

        const paramOverrides = buildParamOverrides(route, scenario.paramMode, legacyState)
        scenario.paramOverrides = paramOverrides

        let tablesToCheck = METHOD_MUTATES.has(route.method) ? tablesForRoute(route.path, tablesLegacy) : []
        if (METHOD_MUTATES.has(route.method)) {
          for (const table of SIDE_EFFECT_TABLES) {
            if (tablesLegacy.has(table) && !tablesToCheck.includes(table)) {
              tablesToCheck.push(table)
            }
          }
        }
        if (tablesToCheck.length) {
          tablesToCheck = tablesToCheck.filter((table) => tablesNew.has(table))
        }
        const beforeLegacy = tablesToCheck.length ? await snapshotTables(legacyDbClient, tablesToCheck) : null
        const beforeNew = tablesToCheck.length ? await snapshotTables(newDbClient, tablesToCheck) : null

        const canRowDiff = primaryTable && scenario.paramMode === 'valid' && METHOD_MUTATES.has(route.method)
        let primaryIdLegacy = null
        let primaryIdNew = null
        let beforeRowLegacy = null
        let beforeRowNew = null
        if (canRowDiff) {
          const skipBeforeSnapshot = route.method === 'POST' && !idParam
          if (idParam) {
            primaryIdLegacy = await resolveParamValue({
              param: idParam,
              route: route.path,
              client: legacyDbClient,
              tables: tablesLegacy,
              state: legacyState,
            })
            primaryIdNew = await resolveParamValue({
              param: idParam,
              route: route.path,
              client: newDbClient,
              tables: tablesNew,
              state: newState,
            })
          } else {
            primaryIdLegacy = await resolvePrimaryId(legacyDbClient, legacyState, primaryTable)
            primaryIdNew = await resolvePrimaryId(newDbClient, newState, primaryTable)
          }
          if (!skipBeforeSnapshot && primaryIdLegacy) {
            beforeRowLegacy = await snapshotRowById(legacyDbClient, primaryTable, primaryIdLegacy)
          }
          if (!skipBeforeSnapshot && primaryIdNew) {
            beforeRowNew = await snapshotRowById(newDbClient, primaryTable, primaryIdNew)
          }
        }

        let restoreLegacy = async () => {}
        let restoreNew = async () => {}
        if (scenario.dbVariant && primaryTable) {
          const legacyId = await getResourceId(legacyDbClient, legacyState, idParam, primaryTable)
          const newId = await getResourceId(newDbClient, newState, idParam, primaryTable)
          if (legacyId && newId) {
            const appliedLegacy = await applyDbVariant(legacyDbClient, primaryTable, legacyId, scenario.dbVariant)
            const appliedNew = await applyDbVariant(newDbClient, primaryTable, newId, scenario.dbVariant)
            if (!appliedLegacy.applied || !appliedNew.applied) {
              await appliedLegacy.restore()
              await appliedNew.restore()
              continue
            }
            restoreLegacy = appliedLegacy.restore
            restoreNew = appliedNew.restore
          } else {
            continue
          }
        }

        const runScenarioForEnv = async ({ state, client, tables, baseUrl, env, authHeader }) => {
          const repeatCount = scenario.repeatCount ?? (scenario.actionRepeat ? 2 : 1)
          for (let i = 0; i < repeatCount - 1; i += 1) {
            await executeRoute({
              route,
              state,
              client,
              tables,
              baseUrl,
              env,
              authHeader,
              scenario,
            })
          }
          const { parsed } = await executeRoute({
            route,
            state,
            client,
            tables,
            baseUrl,
            env,
            authHeader,
            scenario,
          })
          return parsed
        }

        let legacyParsed
        let newParsed
        let afterRowLegacy = null
        let afterRowNew = null
        try {
          legacyParsed = await runScenarioForEnv({
            state: legacyState,
            client: legacyDbClient,
            tables: tablesLegacy,
            baseUrl: legacyRequestBaseUrl,
            env: legacyEnv,
            authHeader: authHeaderLegacy,
          })
          if (canRowDiff) {
            let afterId = primaryIdLegacy
            if (!idParam && route.method === 'POST') {
              const extracted = extractIdFromResponse(legacyParsed.body)
              afterId = extracted ?? (await selectLatestId(legacyDbClient, primaryTable))
            }
            afterRowLegacy = await snapshotRowById(legacyDbClient, primaryTable, afterId)
          }
        } finally {
          await restoreLegacy()
        }

        try {
          newParsed = await runScenarioForEnv({
            state: newState,
            client: newDbClient,
            tables: tablesNew,
            baseUrl: newRequestBaseUrl,
            env: newEnv,
            authHeader: authHeaderNew,
          })
          if (canRowDiff) {
            let afterId = primaryIdNew
            if (!idParam && route.method === 'POST') {
              const extracted = extractIdFromResponse(newParsed.body)
              afterId = extracted ?? (await selectLatestId(newDbClient, primaryTable))
            }
            afterRowNew = await snapshotRowById(newDbClient, primaryTable, afterId)
          }
        } finally {
          await restoreNew()
        }

        if (legacyParsed.status !== newParsed.status) {
          mismatches.push({
            route: `${route.method} /api${route.path}`,
            scenario: scenario.name,
            legacy: legacyParsed.status,
            new: newParsed.status,
            ...(verboseMismatch
              ? {
                  legacyBody: legacyParsed.body ?? legacyParsed.text ?? null,
                  newBody: newParsed.body ?? newParsed.text ?? null,
                }
              : {}),
          })
        }

        if (
          typeof legacyParsed.status === 'number' &&
          legacyParsed.status < 400 &&
          typeof newParsed.status === 'number' &&
          newParsed.status < 400 &&
          legacyParsed.body &&
          newParsed.body
        ) {
          const normalizedLegacy = normalizeResponseValue(legacyParsed.body, { sortArrays: true })
          const normalizedNew = normalizeResponseValue(newParsed.body, { sortArrays: true })
          if (JSON.stringify(normalizedLegacy) !== JSON.stringify(normalizedNew)) {
            bodyMismatches.push({
              route: `${route.method} /api${route.path}`,
              scenario: scenario.name,
              ...(verboseMismatch
                ? {
                    legacyBody: legacyParsed.body,
                    newBody: newParsed.body,
                  }
                : {}),
            })
          }
          const routeKey = `${route.method} /api${route.path}`
          if (!ORDER_INSENSITIVE_ROUTES.has(routeKey)) {
            const unsortedLegacy = normalizeResponseValue(legacyParsed.body, { sortArrays: false })
            const unsortedNew = normalizeResponseValue(newParsed.body, { sortArrays: false })
            if (JSON.stringify(unsortedLegacy) !== JSON.stringify(unsortedNew)) {
              orderMismatches.push({
                route: routeKey,
                scenario: scenario.name,
                ...(verboseMismatch
                  ? {
                      legacyBody: legacyParsed.body,
                      newBody: newParsed.body,
                    }
                  : {}),
              })
            }
          }
        }

        if (
          typeof legacyParsed.status === 'number' &&
          legacyParsed.status >= 400 &&
          typeof newParsed.status === 'number' &&
          newParsed.status >= 400 &&
          legacyParsed.body &&
          newParsed.body
        ) {
          const shapeLegacy = normalizeErrorShape(legacyParsed.body)
          const shapeNew = normalizeErrorShape(newParsed.body)
          if (JSON.stringify(shapeLegacy) !== JSON.stringify(shapeNew)) {
            errorMismatches.push({
              route: `${route.method} /api${route.path}`,
              scenario: scenario.name,
              ...(verboseMismatch
                ? {
                    legacyBody: legacyParsed.body ?? legacyParsed.text ?? null,
                    newBody: newParsed.body ?? newParsed.text ?? null,
                  }
                : {}),
            })
          }
        }

        if (canRowDiff) {
          const legacyDiff = diffRow(beforeRowLegacy, afterRowLegacy)
          const newDiff = diffRow(beforeRowNew, afterRowNew)
          if (JSON.stringify(legacyDiff) !== JSON.stringify(newDiff)) {
            rowMismatches.push({
              route: `${route.method} /api${route.path}`,
              scenario: scenario.name,
              legacy: legacyDiff,
              new: newDiff,
            })
          }
        }

        if (tablesToCheck.length) {
          const afterLegacy = await snapshotTables(legacyDbClient, tablesToCheck)
          const afterNew = await snapshotTables(newDbClient, tablesToCheck)
          const diffLegacy = diffSnapshots(beforeLegacy, afterLegacy)
          const diffNew = diffSnapshots(beforeNew, afterNew)
          if (JSON.stringify(diffLegacy) !== JSON.stringify(diffNew)) {
            dbMismatches.push({
              route: `${route.method} /api${route.path}`,
              scenario: scenario.name,
              legacy: diffLegacy,
              new: diffNew,
            })
          }
        }
      }
    }

    const result = {
      comparedRoutes: routes.length,
      mismatches,
      bodyMismatches,
      dbMismatches,
      errorMismatches,
      orderMismatches,
      rowMismatches,
    }

    await new Promise((resolve, reject) => {
      const stream = createWriteStream(outputPath)
      stream.on('error', reject)
      stream.on('finish', resolve)
      stream.write(JSON.stringify(result, null, 2))
      stream.end()
    })

    console.log(`Compared ${routes.length} legacy routes with error matrix`)
    console.log(`Status mismatches: ${mismatches.length}`)
    console.log(`Body shape mismatches: ${bodyMismatches.length}`)
    console.log(`DB state mismatches: ${dbMismatches.length}`)
    console.log(`Error shape mismatches: ${errorMismatches.length}`)
    console.log(`Order mismatches: ${orderMismatches.length}`)
    console.log(`Row mismatches: ${rowMismatches.length}`)
    console.log(`Results written to ${outputPath}`)
  } finally {
    stopProcess(legacyProc)
    stopProcess(newProc)

    if (legacyDbClient) {
      try {
        await legacyDbClient.end()
      } catch {}
    }
    if (newDbClient) {
      try {
        await newDbClient.end()
      } catch {}
    }

    if (!keepDbs && dbsCreated) {
      try {
        await dropDatabase(admin, legacyDb)
      } catch {}
      try {
        await dropDatabase(admin, newDb)
      } catch {}
      if (templateCreated) {
        try {
          await dropDatabase(admin, templateDbName)
        } catch {}
      }
    } else if (keepDbs && dbsCreated) {
      console.log(`DBs retained: ${legacyDb}, ${newDb}`)
      if (templateCreated) {
        console.log(`Template DB retained: ${templateDbName}`)
      }
    }

    if (!keepLogs) {
      rmSync(logDir, { recursive: true, force: true })
    } else {
      console.log(`Logs retained: ${logDir}`)
    }

    await admin.end()
  }
}

await run()
