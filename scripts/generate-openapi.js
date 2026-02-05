const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'src', 'app', 'api')
const OUTPUT = path.join(__dirname, '..', 'docs', 'openapi.json')

const EXCLUDED_TOP_DIRS = new Set(['orpc'])
const EXCLUDED_WEBHOOK_PATHS = new Set([
  '/api/stripeEvents',
  '/api/mandrillEvents',
  '/api/appStoreServerNotifications',
  '/api/twilioStatusMessage',
])

const REQUEST_BODY_SCHEMA_NAMES = ['requestBodySchema', 'requestSchema', 'bodySchema', 'payloadSchema', 'inputSchema']

const METHOD_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']

const RESPONSE_OVERRIDES = new Map([
  ['/api/icalendar/{id}', { contentType: 'text/calendar', schema: { type: 'string' } }],
  ['/api/ics', { contentType: 'text/calendar', schema: { type: 'string' } }],
  ['/api/sessionInvitationLinks/{invitationId}', { contentType: 'text/html', schema: { type: 'string' } }],
  ['/api/buckets/ptbizapp-images/download/{imageUrl}', { contentType: 'text/plain', schema: { type: 'string' } }],
])

const REQUEST_CONTENT_TYPE_OVERRIDES = new Map([
  ['/api/trainer/upload', 'multipart/form-data'],
  ['/api/financeItems/{financeItemId}/upload', 'multipart/form-data'],
  ['/api/products/{productId}/upload', 'multipart/form-data'],
  ['/api/buckets/ptbizapp-images/upload', 'multipart/form-data'],
])

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
      continue
    }
    if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full)
    }
  }
  return out
}

const toRoutePath = (filePath) => {
  const rel = path.relative(ROOT, filePath)
  const parts = rel.split(path.sep)
  parts.pop()

  const pathSegments = []
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('(') && part.endsWith(')')) {
      continue
    }
    const dynamicMatch = part.match(/^\[(\[?\.\.\.)?(.+?)\]$/)
    if (dynamicMatch) {
      pathSegments.push(`{${dynamicMatch[2]}}`)
    } else {
      pathSegments.push(part)
    }
  }

  return {
    path: `/api/${pathSegments.join('/')}`,
    segments: pathSegments,
  }
}

const parseMethods = (text) => {
  const methods = new Set()
  const fnRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g
  const constRe = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=/g
  const reexportRe = /export\s*\{[^}]*\bas\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b[^}]*\}/g

  let match
  while ((match = fnRe.exec(text))) {
    methods.add(match[1])
  }
  while ((match = constRe.exec(text))) {
    methods.add(match[1])
  }
  while ((match = reexportRe.exec(text))) {
    methods.add(match[1])
  }

  return Array.from(methods)
}

const includesAuth = (text) =>
  text.includes('authenticateTrainerRequest') || text.includes('authenticateTrainerOrClientRequest')

const isClientOnly = (text) => {
  const hasClient = text.includes('authenticateClientRequest')
  const hasTrainer = text.includes('authenticateTrainerRequest')
  const hasEither = text.includes('authenticateTrainerOrClientRequest')
  return hasClient && !hasTrainer && !hasEither
}

const findObjectLiteral = (text, startIndex) => {
  const braceStart = text.indexOf('{', startIndex)
  if (braceStart === -1) return null

  let depth = 0
  let inString = false
  let stringChar = ''
  let inLineComment = false
  let inBlockComment = false

  for (let i = braceStart; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (inLineComment) {
      if (char === '\n') inLineComment = false
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (!inString) {
      if (char === '/' && next === '/') {
        inLineComment = true
        i += 1
        continue
      }
      if (char === '/' && next === '*') {
        inBlockComment = true
        i += 1
        continue
      }
    }

    if (inString) {
      if (char === '\\') {
        i += 1
        continue
      }
      if (char === stringChar) {
        inString = false
        stringChar = ''
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true
      stringChar = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(braceStart + 1, i)
      }
    }
  }

  return null
}

const extractObjectKeys = (text, varName) => {
  const varRe = new RegExp(`\\b${varName}\\b\\s*=\\s*z\\.object\\s*\\(`)
  const match = varRe.exec(text)
  if (!match) return null

  const objectLiteral = findObjectLiteral(text, match.index + match[0].length)
  if (!objectLiteral) return null

  const keys = []
  let depth = 0
  let inString = false
  let stringChar = ''
  let inLineComment = false
  let inBlockComment = false

  const isIdentifierStart = (char) => /[A-Za-z_$]/.test(char)
  const isIdentifierPart = (char) => /[A-Za-z0-9_$]/.test(char)

  for (let i = 0; i < objectLiteral.length; i += 1) {
    const char = objectLiteral[i]
    const next = objectLiteral[i + 1]

    if (inLineComment) {
      if (char === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (!inString) {
      if (char === '/' && next === '/') {
        inLineComment = true
        i += 1
        continue
      }
      if (char === '/' && next === '*') {
        inBlockComment = true
        i += 1
        continue
      }
    }

    if (inString) {
      if (char === '\\') {
        i += 1
        continue
      }
      if (char === stringChar) {
        inString = false
        stringChar = ''
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true
      stringChar = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      continue
    }

    if (depth !== 0) {
      continue
    }

    if (char === '.' && objectLiteral.slice(i, i + 3) === '...') {
      continue
    }

    if (isIdentifierStart(char)) {
      let j = i + 1
      while (j < objectLiteral.length && isIdentifierPart(objectLiteral[j])) j += 1
      const key = objectLiteral.slice(i, j)
      let k = j
      while (k < objectLiteral.length && /\s/.test(objectLiteral[k])) k += 1
      if (objectLiteral[k] === ':') {
        keys.push(key)
      }
      i = j - 1
      continue
    }

    if (char === '"' || char === "'") {
      let j = i + 1
      while (j < objectLiteral.length && objectLiteral[j] !== char) {
        if (objectLiteral[j] === '\\') j += 1
        j += 1
      }
      const key = objectLiteral.slice(i + 1, j)
      let k = j + 1
      while (k < objectLiteral.length && /\s/.test(objectLiteral[k])) k += 1
      if (objectLiteral[k] === ':') {
        keys.push(key)
      }
      i = j
    }
  }

  return keys.length > 0 ? Array.from(new Set(keys)) : null
}

const buildOperationId = (method, segments) => {
  const toPascal = (value) =>
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join('')

  const parts = segments.map((segment) => {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      return `By${toPascal(segment.slice(1, -1))}`
    }
    return toPascal(segment)
  })

  return method.toLowerCase() + parts.join('')
}

const guessQueryParams = (text) => extractObjectKeys(text, 'querySchema') || []

const guessRequestBodyKeys = (text) => {
  for (const name of REQUEST_BODY_SCHEMA_NAMES) {
    const keys = extractObjectKeys(text, name)
    if (keys && keys.length > 0) return keys
  }
  return null
}

const buildRequestBodySchema = (keys) => {
  if (!keys || keys.length === 0) {
    return { type: 'object', additionalProperties: true }
  }

  const properties = {}
  for (const key of keys) {
    properties[key] = {}
  }

  return {
    type: 'object',
    properties,
    additionalProperties: true,
  }
}

const buildSpec = (routes) => {
  const paths = {}
  const usedOperationIds = new Set()

  for (const route of routes) {
    const { path: routePath, segments, methods, requiresAuth, queryParams, requestBodyKeys } = route
    if (!paths[routePath]) paths[routePath] = {}

    for (const method of methods) {
      const lower = method.toLowerCase()
      let operationId = buildOperationId(method, segments)
      if (usedOperationIds.has(operationId)) {
        let idx = 2
        while (usedOperationIds.has(`${operationId}${idx}`)) idx += 1
        operationId = `${operationId}${idx}`
      }
      usedOperationIds.add(operationId)

      const parameters = []

      for (const segment of segments) {
        if (segment.startsWith('{') && segment.endsWith('}')) {
          const name = segment.slice(1, -1)
          parameters.push({
            name,
            in: 'path',
            required: true,
            schema: { type: 'string' },
          })
        }
      }

      for (const name of queryParams) {
        parameters.push({
          name,
          in: 'query',
          required: false,
          schema: { type: 'string' },
        })
      }

      const requestContentType = REQUEST_CONTENT_TYPE_OVERRIDES.get(routePath) || 'application/json'
      const responseOverride = RESPONSE_OVERRIDES.get(routePath)

      const responses = {
        200: {
          description: 'Success',
          content: {
            [responseOverride?.contentType || 'application/json']: {
              schema: responseOverride?.schema || { type: 'object', additionalProperties: true },
            },
          },
        },
        default: {
          description: 'Error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      }

      const operation = {
        operationId,
        tags: [route.tag],
        responses,
      }

      if (parameters.length > 0) {
        operation.parameters = parameters
      }

      if (requiresAuth) {
        operation.security = [{ BearerAuth: [] }]
      }

      if (['post', 'put', 'patch', 'delete'].includes(lower)) {
        const isMultipart = requestContentType === 'multipart/form-data'
        operation.requestBody = {
          required: isMultipart,
          content: {
            [requestContentType]: {
              schema: buildRequestBodySchema(requestBodyKeys),
            },
          },
        }
      }

      paths[routePath][lower] = operation
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'KeepOn Legacy API',
      version: '1.0.0',
    },
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['code', 'status', 'message', 'error', 'type', 'title'],
          properties: {
            code: { type: 'number' },
            status: { type: 'number' },
            message: { type: 'string' },
            error: {
              type: 'object',
              required: ['statusCode', 'message'],
              properties: {
                statusCode: { type: 'number' },
                message: { type: 'string' },
              },
              additionalProperties: false,
            },
            type: { type: 'string' },
            title: { type: 'string' },
            detail: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
  }
}

const main = () => {
  const files = walk(ROOT)
  const routes = []

  for (const filePath of files) {
    const { path: routePath, segments } = toRoutePath(filePath)
    if (!routePath.startsWith('/api/')) continue

    const topDir = segments[0]
    if (EXCLUDED_TOP_DIRS.has(topDir)) continue
    if (EXCLUDED_WEBHOOK_PATHS.has(routePath)) continue

    const text = fs.readFileSync(filePath, 'utf8')
    if (isClientOnly(text)) continue

    const methods = parseMethods(text)
    if (methods.length === 0) continue

    const requiresAuth = includesAuth(text)
    const queryParams = guessQueryParams(text)
    const requestBodyKeys = guessRequestBodyKeys(text)

    routes.push({
      filePath,
      path: routePath,
      segments,
      methods,
      requiresAuth,
      queryParams,
      requestBodyKeys,
      tag: segments[0] || 'api',
    })
  }

  routes.sort((a, b) => a.path.localeCompare(b.path))

  const spec = buildSpec(routes)
  const json = JSON.stringify(spec, null, 2)

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUTPUT)) {
      console.error('openapi.json is missing. Run generate-openapi.js to create it.')
      process.exit(1)
    }
    const current = fs.readFileSync(OUTPUT, 'utf8')
    if (current.trim() !== json.trim()) {
      console.error('openapi.json is out of date. Run generate-openapi.js to update it.')
      process.exit(1)
    }
    return
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, json, 'utf8')
}

main()
