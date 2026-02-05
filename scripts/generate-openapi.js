const fs = require('fs')
const path = require('path')

const NEW_API_ROOT = path.join(__dirname, '..', 'src', 'app', 'api')
const OUTPUT = path.join(__dirname, '..', 'docs', 'openapi.json')

const LEGACY_ROOT_DEFAULT = '/Users/francis/repos/keepon-full/api-server'
const LEGACY_ROUTES_DEFAULT = path.join(LEGACY_ROOT_DEFAULT, 'src', 'routes')

const EXCLUDED_PATHS = new Set(['/api/accessToken', '/api/workflows/dispatch'])

const EXCLUDED_PATH_PREFIXES = ['/api/orpc']

const EXCLUDED_WEBHOOK_PATHS = new Set([
  '/api/stripeEvents',
  '/api/mandrillEvents',
  '/api/appStoreServerNotifications',
  '/api/twilioStatusMessage',
])

const RESPONSE_OVERRIDES = new Map([
  ['/api/icalendar/{id}', { status: 200, contentType: 'text/calendar', schema: { type: 'string' } }],
  ['/api/ics', { status: 200, contentType: 'text/calendar', schema: { type: 'string' } }],
  ['/api/sessionInvitationLinks/{invitationId}', { status: 200, contentType: 'text/html', schema: { type: 'string' } }],
  ['/api/buckets/ptbizapp-images/download/{imageUrl}', { status: 302 }],
])

const REQUEST_CONTENT_TYPE_OVERRIDES = new Map([
  ['/api/trainer/upload', 'multipart/form-data'],
  ['/api/financeItems/{financeItemId}/upload', 'multipart/form-data'],
  ['/api/products/{productId}/upload', 'multipart/form-data'],
  ['/api/buckets/ptbizapp-images/upload', 'multipart/form-data'],
])

const MULTIPART_BODY_OVERRIDES = new Map([
  [
    '/api/trainer/upload',
    {
      type: 'object',
      properties: {
        businessLogo: { type: 'string', format: 'binary' },
        businessIcon: { type: 'string', format: 'binary' },
        coverImage: { type: 'string', format: 'binary' },
        id: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
  [
    '/api/financeItems/{financeItemId}/upload',
    { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, additionalProperties: false },
  ],
  [
    '/api/products/{productId}/upload',
    { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, additionalProperties: false },
  ],
  [
    '/api/buckets/ptbizapp-images/upload',
    { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, additionalProperties: false },
  ],
])

const METHOD_NAMES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

const readArg = (name) => {
  const index = process.argv.indexOf(name)
  return index !== -1 ? process.argv[index + 1] : undefined
}

const legacyRootArg = readArg('--legacy-root')
const LEGACY_ROOT = legacyRootArg
  ? legacyRootArg.endsWith(path.join('src', 'routes'))
    ? path.resolve(legacyRootArg, '..', '..')
    : legacyRootArg
  : LEGACY_ROOT_DEFAULT
const LEGACY_ROUTES_DIR = legacyRootArg
  ? legacyRootArg.endsWith(path.join('src', 'routes'))
    ? legacyRootArg
    : path.join(legacyRootArg, 'src', 'routes')
  : LEGACY_ROUTES_DEFAULT

let ts
try {
  ts = require('typescript')
} catch (error) {
  const fallback = path.join(LEGACY_ROOT, 'node_modules', 'typescript')
  try {
    ts = require(fallback)
  } catch (fallbackError) {
    throw new Error(
      `Unable to load typescript. Install it locally or ensure it exists at ${fallback}. Original error: ${error?.message}`
    )
  }
}

const RESPONSE_SCHEMA_OVERRIDES = new Map([
  [
    '/api/appStoreReceipts',
    { filePath: path.join(LEGACY_ROOT, 'src', 'logic', 'process-apple-receipt.ts'), name: 'AppStoreReceipt' },
  ],
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
  const rel = path.relative(NEW_API_ROOT, filePath)
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

  let match
  while ((match = fnRe.exec(text))) {
    methods.add(match[1])
  }
  while ((match = constRe.exec(text))) {
    methods.add(match[1])
  }

  for (const exportMatch of text.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)) {
    const items = exportMatch[1].split(',')
    for (const raw of items) {
      const item = raw.trim()
      if (!item) continue
      const parts = item.split(/\s+as\s+/i).map((value) => value.trim())
      const alias = parts.length > 1 ? parts[1] : parts[0]
      if (METHOD_NAMES.has(alias)) {
        methods.add(alias)
      }
    }
  }

  return Array.from(methods)
}

const normalizePath = (value) => value.replaceAll(/\{[^}]+\}/g, ':param').replaceAll(/:([A-Za-z0-9_]+)\*?/g, ':param')

const toLegacyLookupKey = (method, pathValue) => `${method} ${normalizePath(pathValue)}`

const fileCache = new Map()
const schemaCache = new Map()
const resolvingSchemas = new Set()

const SHARED_OVERRIDES = {
  email: { type: 'string', format: 'email' },
  dateOrIsoDateString: { type: 'string', format: 'date' },
  dateOrIsoDateTimeString: { type: 'string', format: 'date-time' },
  dateTimeString: { type: 'string', format: 'date-time' },
  duration: { type: 'string' },
  timezone: { type: 'string' },
  trimmed: { type: 'string' },
  emptyIsNull: { type: ['string', 'null'] },
  stringTrimmedToNull: { type: ['string', 'null'] },
  money: { type: 'number' },
}

const DECODER_OVERRIDES = {
  int: { type: 'integer' },
  date: { type: 'string', format: 'date-time' },
  bigNumber: { type: 'number' },
}

const resolveImportPath = (specifier, fromFile) => {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null
  }
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

const getFileInfo = (filePath) => {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
  const locals = new Map()
  const exports = new Map()
  const imports = new Map()
  const namespaceImports = new Map()
  const decoderNamespaces = new Set()

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier.text
      const resolved = resolveImportPath(moduleSpecifier, filePath)
      const importClause = statement.importClause
      if (!importClause) continue
      if (importClause.name) {
        if (resolved) {
          imports.set(importClause.name.text, { source: resolved, name: 'default', kind: 'default' })
        }
      }
      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          const localName = importClause.namedBindings.name.text
          if (resolved) {
            namespaceImports.set(localName, { source: resolved })
          }
          if (moduleSpecifier === 'io-ts/Decoder') {
            decoderNamespaces.add(localName)
          }
        }
        if (ts.isNamedImports(importClause.namedBindings)) {
          for (const element of importClause.namedBindings.elements) {
            const localName = element.name.text
            const importName = element.propertyName ? element.propertyName.text : element.name.text
            if (resolved) {
              imports.set(localName, { source: resolved, name: importName, kind: 'named' })
            }
          }
        }
      }
    }

    if (ts.isVariableStatement(statement)) {
      const isExported = statement.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        locals.set(declaration.name.text, declaration.initializer)
        if (isExported) {
          exports.set(declaration.name.text, declaration.initializer)
        }
      }
    }

    if (ts.isExportAssignment(statement)) {
      exports.set('default', statement.expression)
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text
        const localName = element.propertyName ? element.propertyName.text : element.name.text
        exports.set(exportedName, ts.factory.createIdentifier(localName))
      }
    }
  }

  const info = { sourceFile, locals, exports, imports, namespaceImports, decoderNamespaces }
  fileCache.set(filePath, info)
  return info
}

const isDecoderNamespace = (identifier, fileInfo) => fileInfo.decoderNamespaces.has(identifier)

const getOverrideSchema = (filePath, exportName) => {
  if (filePath.endsWith(path.join('types', 'api', '_shared.ts')) && SHARED_OVERRIDES[exportName]) {
    return SHARED_OVERRIDES[exportName]
  }
  if (filePath.endsWith(path.join('types', 'decoders.ts')) && DECODER_OVERRIDES[exportName]) {
    return DECODER_OVERRIDES[exportName]
  }
  return null
}

const schemaFromExpr = (expr, filePath) => {
  if (!expr) return {}
  const fileInfo = getFileInfo(filePath)

  if (ts.isIdentifier(expr)) {
    return schemaFromIdentifier(expr.text, filePath)
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      const base = expr.expression.text
      if (isDecoderNamespace(base, fileInfo)) {
        return schemaFromDecoderToken(expr.name.text)
      }
      if (fileInfo.namespaceImports.has(base)) {
        const module = fileInfo.namespaceImports.get(base)
        if (module?.source) {
          const override = getOverrideSchema(module.source, expr.name.text)
          if (override) return override
          return schemaFromExport(module.source, expr.name.text)
        }
      }
    }
    return {}
  }

  if (ts.isCallExpression(expr)) {
    return schemaFromCallExpression(expr, filePath)
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const objectSchema = schemaFromObjectLiteral(expr, filePath, true)
    return objectSchema
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const items = expr.elements.map((element) => schemaFromExpr(element, filePath))
    return { type: 'array', items: { oneOf: items } }
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { type: 'string' }
  }

  if (ts.isNumericLiteral(expr)) {
    return { type: 'number' }
  }

  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { type: ['null'] }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) {
    return { type: 'number' }
  }

  return {}
}

const schemaFromIdentifier = (name, filePath) => {
  const key = `${filePath}::${name}`
  if (schemaCache.has(key)) {
    return schemaCache.get(key)
  }

  const override = getOverrideSchema(filePath, name)
  if (override) {
    schemaCache.set(key, override)
    return override
  }

  if (resolvingSchemas.has(key)) {
    return {}
  }

  resolvingSchemas.add(key)
  const fileInfo = getFileInfo(filePath)
  let schema = {}

  if (fileInfo.locals.has(name)) {
    schema = schemaFromExpr(fileInfo.locals.get(name), filePath)
  } else if (fileInfo.imports.has(name)) {
    const info = fileInfo.imports.get(name)
    if (info?.source) {
      const overrideImport = getOverrideSchema(info.source, info.name)
      if (overrideImport) {
        schema = overrideImport
      } else {
        schema = schemaFromExport(info.source, info.name)
      }
    }
  } else if (fileInfo.exports.has(name)) {
    schema = schemaFromExport(filePath, name)
  }

  schemaCache.set(key, schema)
  resolvingSchemas.delete(key)
  return schema
}

const schemaFromExport = (filePath, exportName) => {
  const override = getOverrideSchema(filePath, exportName)
  if (override) return override

  const fileInfo = getFileInfo(filePath)
  if (!fileInfo.exports.has(exportName)) {
    return schemaFromIdentifier(exportName, filePath)
  }
  const expr = fileInfo.exports.get(exportName)
  return schemaFromExpr(expr, filePath)
}

const schemaFromDecoderToken = (name) => {
  switch (name) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'unknown':
      return {}
    case 'null':
      return { type: ['null'] }
    case 'UnknownArray':
      return { type: 'array', items: {} }
    case 'UnknownRecord':
      return { type: 'object', additionalProperties: true }
    default:
      return {}
  }
}

const schemaFromCallExpression = (expr, filePath) => {
  const fileInfo = getFileInfo(filePath)
  const callee = expr.expression

  if (ts.isIdentifier(callee) && callee.text === 'pipe') {
    return schemaFromPipe(expr.arguments, filePath)
  }

  if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression)) {
    if (
      ts.isIdentifier(callee.expression.expression) &&
      isDecoderNamespace(callee.expression.expression.text, fileInfo) &&
      callee.expression.name.text === 'sum'
    ) {
      const tagArg = callee.arguments[0]
      const mappingArg = expr.arguments[0]
      if (!tagArg || !mappingArg || !ts.isStringLiteral(tagArg) || !ts.isObjectLiteralExpression(mappingArg)) {
        return {}
      }
      return schemaFromSum(tagArg.text, mappingArg, filePath)
    }
  }

  if (ts.isPropertyAccessExpression(callee)) {
    if (ts.isIdentifier(callee.expression) && isDecoderNamespace(callee.expression.text, fileInfo)) {
      const name = callee.name.text
      switch (name) {
        case 'struct':
          return schemaFromObjectArgument(expr.arguments[0], filePath, true)
        case 'partial':
          return schemaFromObjectArgument(expr.arguments[0], filePath, false)
        case 'array':
          return { type: 'array', items: schemaFromExpr(expr.arguments[0], filePath) }
        case 'union':
          return schemaFromUnion(expr.arguments, filePath)
        case 'intersect':
          return schemaFromIntersect(expr.arguments, filePath)
        case 'literal':
          return schemaFromLiteral(expr.arguments)
        case 'nullable':
          return schemaFromNullable(expr.arguments[0], filePath)
        case 'record':
          return schemaFromRecord(expr.arguments, filePath)
        case 'tuple':
          return schemaFromTuple(expr.arguments, filePath)
        case 'id':
          return { description: 'Any JSON value' }
        case 'compose':
        case 'parse':
        case 'refine':
        case 'fromRefinement':
        case 'mapLeftWithInput':
          return schemaFromExpr(expr.arguments[0], filePath)
        default:
          return {}
      }
    }
  }

  return {}
}

const schemaFromPipe = (args, filePath) => {
  if (!args.length) return {}
  let schema = schemaFromExpr(args[0], filePath)
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]
    if (ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression)) {
      const callee = arg.expression
      const fileInfo = getFileInfo(filePath)
      if (ts.isIdentifier(callee.expression) && isDecoderNamespace(callee.expression.text, fileInfo)) {
        if (callee.name.text === 'intersect' && arg.arguments.length === 1) {
          const other = schemaFromExpr(arg.arguments[0], filePath)
          schema = mergeObjectSchemas(schema, other)
          continue
        }
        if (['compose', 'parse', 'refine', 'fromRefinement', 'mapLeftWithInput'].includes(callee.name.text)) {
          continue
        }
      }
    }
  }
  return schema
}

const schemaFromObjectArgument = (expr, filePath, required) => {
  if (!expr) return { type: 'object', properties: {}, additionalProperties: false }
  if (ts.isIdentifier(expr)) {
    const resolved = resolveIdentifierExpression(expr.text, filePath)
    if (resolved?.expr) {
      return schemaFromObjectArgument(resolved.expr, resolved.filePath, required)
    }
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return schemaFromObjectLiteral(expr, filePath, required)
  }
  return schemaFromExpr(expr, filePath)
}

const schemaFromObjectLiteral = (expr, filePath, required) => {
  const properties = {}
  const requiredKeys = []

  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = getPropertyKey(prop.name)
      if (!key) continue
      properties[key] = schemaFromExpr(prop.initializer, filePath)
      if (required) {
        requiredKeys.push(key)
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text
      properties[key] = schemaFromIdentifier(key, filePath)
      if (required) {
        requiredKeys.push(key)
      }
    } else if (ts.isSpreadAssignment(prop)) {
      const spreadProps = resolveSpreadProperties(prop.expression, filePath)
      for (const [key, valueExpr] of Object.entries(spreadProps)) {
        properties[key] = schemaFromExpr(valueExpr, filePath)
        if (required) {
          requiredKeys.push(key)
        }
      }
    }
  }

  const schema = { type: 'object', properties, additionalProperties: false }
  if (required && requiredKeys.length) {
    schema.required = Array.from(new Set(requiredKeys))
  }
  return schema
}

const resolveSpreadProperties = (expr, filePath) => {
  if (ts.isIdentifier(expr)) {
    const resolved = resolveIdentifierExpression(expr.text, filePath)
    if (resolved?.expr) {
      return resolveSpreadProperties(resolved.expr, resolved.filePath)
    }
    return {}
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const out = {}
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = getPropertyKey(prop.name)
        if (!key) continue
        out[key] = prop.initializer
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        out[prop.name.text] = ts.factory.createIdentifier(prop.name.text)
      } else if (ts.isSpreadAssignment(prop)) {
        Object.assign(out, resolveSpreadProperties(prop.expression, filePath))
      }
    }
    return out
  }
  return {}
}

const resolveIdentifierExpression = (name, filePath) => {
  const fileInfo = getFileInfo(filePath)
  if (fileInfo.locals.has(name)) {
    return { expr: fileInfo.locals.get(name), filePath }
  }
  if (fileInfo.imports.has(name)) {
    const info = fileInfo.imports.get(name)
    if (info?.source) {
      return { expr: ts.factory.createIdentifier(info.name), filePath: info.source }
    }
  }
  if (fileInfo.exports.has(name)) {
    return { expr: fileInfo.exports.get(name), filePath }
  }
  return null
}

const getPropertyKey = (nameNode) => {
  if (ts.isIdentifier(nameNode)) return nameNode.text
  if (ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.text
  return null
}

const schemaFromUnion = (args, filePath) => {
  let members = args
  if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
    members = args[0].elements
  }
  const schemas = members.map((member) => schemaFromExpr(member, filePath))
  const nullSchemas = schemas.filter((schema) => isOnlyNullSchema(schema))
  const nonNullSchemas = schemas.filter((schema) => !isOnlyNullSchema(schema))
  if (nullSchemas.length) {
    if (nonNullSchemas.length === 1) {
      return addNullToSchema(nonNullSchemas[0])
    }
    if (nonNullSchemas.length > 1) {
      const [primary, ...rest] = nonNullSchemas
      return { oneOf: [addNullToSchema(primary), ...rest] }
    }
  }
  return { oneOf: schemas }
}

const schemaFromIntersect = (args, filePath) => {
  let members = args
  if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
    members = args[0].elements
  }
  const schemas = members.map((member) => schemaFromExpr(member, filePath))
  return schemas.reduce((acc, schema) => mergeObjectSchemas(acc, schema))
}

const mergeObjectSchemas = (a, b) => {
  if (!a || !b) return a || b || {}
  const combineAllOf = (left, right) => {
    const allOf = []
    const pushSchema = (schema) => {
      if (!schema || Object.keys(schema).length === 0) return
      if (schema.allOf && Array.isArray(schema.allOf)) {
        allOf.push(...schema.allOf)
      } else {
        allOf.push(schema)
      }
    }
    pushSchema(left)
    pushSchema(right)
    if (allOf.length === 1) return allOf[0]
    return { allOf }
  }
  if (a.oneOf || a.anyOf || a.allOf || b.oneOf || b.anyOf || b.allOf) {
    return combineAllOf(a, b)
  }
  const aProps = a.properties
  const bProps = b.properties
  if (aProps || bProps) {
    const properties = { ...(aProps || {}), ...(bProps || {}) }
    const required = Array.from(new Set([...(a.required || []), ...(b.required || [])]))
    const merged = { type: 'object', properties, additionalProperties: false }
    if (required.length) {
      merged.required = required
    }
    return merged
  }
  return { allOf: [a, b] }
}

const schemaFromLiteral = (args) => {
  const values = args.map((arg) => {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text
    if (ts.isNumericLiteral(arg)) return Number(arg.text)
    if (arg.kind === ts.SyntaxKind.TrueKeyword) return true
    if (arg.kind === ts.SyntaxKind.FalseKeyword) return false
    if (arg.kind === ts.SyntaxKind.NullKeyword) return null
    return undefined
  })
  const filtered = values.filter((value) => value !== undefined)
  if (!filtered.length) return {}
  if (filtered.includes(null)) {
    return { enum: Array.from(new Set(filtered)) }
  }
  return { enum: Array.from(new Set(filtered)) }
}

const schemaAllowsNull = (schema) => {
  if (!schema) return false
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true
  return false
}

const isOnlyNullSchema = (schema) => {
  if (!schema) return false
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null') return true
  if (Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] === null) return true
  return false
}

const addNullToSchema = (schema) => {
  if (!schema || Object.keys(schema).length === 0) {
    return {}
  }

  if (schema.enum) {
    if (schema.enum.includes(null)) return schema
    return { ...schema, enum: [...schema.enum, null] }
  }

  if (schema.type) {
    if (Array.isArray(schema.type)) {
      if (schema.type.includes('null')) return schema
      return { ...schema, type: [...schema.type, 'null'] }
    }
    if (schema.type === 'null') return schema
    return { ...schema, type: [schema.type, 'null'] }
  }

  if (schema.anyOf) {
    if (schema.anyOf.some((entry) => schemaAllowsNull(entry))) return schema
    return { ...schema, anyOf: [...schema.anyOf, { type: ['null'] }] }
  }

  if (schema.oneOf) {
    if (schema.oneOf.some((entry) => schemaAllowsNull(entry))) return schema
    return { ...schema, oneOf: [...schema.oneOf, { type: ['null'] }] }
  }

  if (schema.allOf) {
    return { anyOf: [schema, { type: ['null'] }] }
  }

  return { anyOf: [schema, { type: ['null'] }] }
}

const schemaFromNullable = (arg, filePath) => addNullToSchema(schemaFromExpr(arg, filePath))

const schemaFromRecord = (args, filePath) => {
  const valueSchema = args.length > 1 ? schemaFromExpr(args[1], filePath) : schemaFromExpr(args[0], filePath)
  return { type: 'object', additionalProperties: valueSchema }
}

const schemaFromTuple = (args, filePath) => {
  let members = args
  if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
    members = args[0].elements
  }
  const schemas = members.map((member) => schemaFromExpr(member, filePath))
  const itemSchema = schemas.length === 1 ? schemas[0] : { oneOf: schemas }
  return { type: 'array', items: itemSchema, minItems: schemas.length, maxItems: schemas.length }
}

const schemaFromSum = (tagName, mappingArg, filePath) => {
  const variants = []
  for (const prop of mappingArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const tagValue = getPropertyKey(prop.name)
    if (!tagValue) continue
    const variantSchema = schemaFromExpr(prop.initializer, filePath)
    const tagSchema = {
      type: 'object',
      properties: { [tagName]: { const: tagValue } },
      required: [tagName],
      additionalProperties: true,
    }
    variants.push({ allOf: [variantSchema, tagSchema] })
  }
  return { oneOf: variants }
}

const SCHEMA_META_KEYS = new Set([
  'title',
  'description',
  'deprecated',
  'readOnly',
  'writeOnly',
  'default',
  'example',
  'examples',
])

const mergeSchemaMeta = (schema, source) => {
  for (const key of SCHEMA_META_KEYS) {
    if (source[key] !== undefined && schema[key] === undefined) {
      schema[key] = source[key]
    }
  }
  return schema
}

const replaceSchema = (target, next) => {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  Object.assign(target, next)
}

const normalizeUnionSchema = (schema, key) => {
  const union = schema[key]
  if (!Array.isArray(union)) return false

  const nullSchemas = union.filter((entry) => isOnlyNullSchema(entry))
  if (!nullSchemas.length) return false

  const nonNullSchemas = union.filter((entry) => !isOnlyNullSchema(entry))
  if (!nonNullSchemas.length) return false

  if (nonNullSchemas.length === 1) {
    const merged = mergeSchemaMeta(addNullToSchema(nonNullSchemas[0]), schema)
    replaceSchema(schema, merged)
    return true
  }

  const [primary, ...rest] = nonNullSchemas
  schema[key] = [addNullToSchema(primary), ...rest]
  return true
}

const normalizeSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema)) {
    schema.forEach((entry) => normalizeSchema(entry))
    return
  }

  for (const value of Object.values(schema)) {
    if (value && typeof value === 'object') {
      normalizeSchema(value)
    }
  }

  const changed = normalizeUnionSchema(schema, 'oneOf') || normalizeUnionSchema(schema, 'anyOf')

  if (changed) {
    normalizeSchema(schema)
  }
}

const parseLegacyRoutes = () => {
  if (!fs.existsSync(LEGACY_ROUTES_DIR)) {
    throw new Error(`Legacy routes directory not found: ${LEGACY_ROUTES_DIR}`)
  }
  const files = fs.readdirSync(LEGACY_ROUTES_DIR).filter((file) => file.endsWith('.ts'))
  const routes = []

  for (const fileName of files) {
    const filePath = path.join(LEGACY_ROUTES_DIR, fileName)
    const content = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const { expression } = node
        if (ts.isIdentifier(expression.expression) && expression.expression.text === 'router') {
          const method = expression.name.text.toUpperCase()
          if (!METHOD_NAMES.has(method)) {
            return
          }
          const [pathArg, optionsArg] = node.arguments
          if (!pathArg || !optionsArg) {
            return
          }
          if (!ts.isStringLiteral(pathArg) && !ts.isNoSubstitutionTemplateLiteral(pathArg)) {
            return
          }
          const routePath = pathArg.text
          const options = parseLegacyOptions(optionsArg, filePath)
          routes.push({ method, path: routePath, filePath, options })
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return routes
}

const parseLegacyOptions = (optionsArg, filePath) => {
  if (!ts.isObjectLiteralExpression(optionsArg)) {
    return { security: null, response: null, request: null, query: null, path: null, filePath }
  }
  const options = { security: null, response: null, request: null, query: null, path: null, filePath }

  for (const prop of optionsArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = getPropertyKey(prop.name)
    if (!key) continue
    if (key === 'security') {
      if (prop.initializer.kind === ts.SyntaxKind.NullKeyword) {
        options.security = null
      } else if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
        options.security = prop.initializer.text
      }
    }
    if (key === 'responseBody') {
      options.response = prop.initializer
    }
    if (key === 'requestBody') {
      options.request = prop.initializer
    }
    if (key === 'queryParameters') {
      options.query = prop.initializer
    }
    if (key === 'pathParameters') {
      options.path = prop.initializer
    }
  }

  return options
}

const parseNewRoutes = () => {
  const files = walk(NEW_API_ROOT)
  const routes = []

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8')
    const methods = parseMethods(text)
    if (!methods.length) continue
    const routeInfo = toRoutePath(filePath)
    for (const method of methods) {
      routes.push({ method, path: routeInfo.path, segments: routeInfo.segments, filePath })
    }
  }

  return routes
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

const schemaToQueryParameters = (schema) => {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return []
  }
  const required = new Set(schema.required || [])
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: propSchema,
  }))
}

const buildSpec = (routes, legacyMap) => {
  const paths = {}
  const usedOperationIds = new Set()
  const unresolved = []

  for (const route of routes) {
    if (EXCLUDED_PATHS.has(route.path)) {
      continue
    }
    if (EXCLUDED_PATH_PREFIXES.some((prefix) => route.path.startsWith(prefix))) {
      continue
    }
    if (EXCLUDED_WEBHOOK_PATHS.has(route.path)) {
      continue
    }
    const legacyKey = toLegacyLookupKey(route.method, route.path)
    const legacy = legacyMap.get(legacyKey)
    if (!legacy) {
      unresolved.push(`${route.method} ${route.path} (missing legacy match)`)
      continue
    }

    if (legacy.options.security === 'client') {
      continue
    }

    if (!paths[route.path]) paths[route.path] = {}

    let operationId = buildOperationId(route.method, route.segments)
    if (usedOperationIds.has(operationId)) {
      let idx = 2
      while (usedOperationIds.has(`${operationId}${idx}`)) idx += 1
      operationId = `${operationId}${idx}`
    }
    usedOperationIds.add(operationId)

    const parameters = []

    for (const segment of route.segments) {
      if (segment.startsWith('{') && segment.endsWith('}')) {
        const name = segment.slice(1, -1)
        parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } })
      }
    }

    let querySchema
    if (legacy.options.query) {
      querySchema = schemaFromExpr(legacy.options.query, legacy.filePath)
      parameters.push(...schemaToQueryParameters(querySchema))
    }

    const requestContentType = REQUEST_CONTENT_TYPE_OVERRIDES.get(route.path) || 'application/json'
    const responseOverride = RESPONSE_OVERRIDES.get(route.path)
    const responseSchemaOverride = RESPONSE_SCHEMA_OVERRIDES.get(route.path)

    const responses = {}

    if (responseOverride) {
      if (responseOverride.schema) {
        responses[responseOverride.status || 200] = {
          description: 'Success',
          content: {
            [responseOverride.contentType || 'application/json']: {
              schema: responseOverride.schema,
            },
          },
        }
      } else {
        responses[responseOverride.status || 204] = { description: 'Success' }
      }
    } else if (legacy.options.response || responseSchemaOverride) {
      const responseSchema = responseSchemaOverride
        ? schemaFromIdentifier(responseSchemaOverride.name, responseSchemaOverride.filePath)
        : schemaFromExpr(legacy.options.response, legacy.filePath)
      if (Object.keys(responseSchema).length === 0) {
        unresolved.push(`${route.method} ${route.path} (unresolved response schema)`)
      }
      responses[200] = {
        description: 'Success',
        content: {
          'application/json': {
            schema: responseSchema,
          },
        },
      }
    } else {
      responses[204] = { description: 'No content' }
    }

    responses.default = {
      description: 'Error',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    }

    const operation = {
      operationId,
      tags: [route.segments[0] || 'api'],
      responses,
    }

    if (parameters.length) {
      operation.parameters = parameters
    }

    if (legacy.options.security === 'serviceProvider' || legacy.options.security === 'serviceProviderOrClient') {
      operation.security = [{ BearerAuth: [] }]
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
      let requestSchema = null
      if (legacy.options.request) {
        requestSchema = schemaFromExpr(legacy.options.request, legacy.filePath)
      }
      if (requestContentType === 'multipart/form-data') {
        requestSchema = MULTIPART_BODY_OVERRIDES.get(route.path) || requestSchema || { type: 'object' }
      }

      if (requestSchema) {
        operation.requestBody = {
          required: true,
          content: {
            [requestContentType]: {
              schema: requestSchema,
            },
          },
        }
      }
    }

    paths[route.path][route.method.toLowerCase()] = operation
  }

  return { paths, unresolved }
}

const main = () => {
  const legacyRoutes = parseLegacyRoutes()
  const legacyMap = new Map()
  for (const route of legacyRoutes) {
    const key = toLegacyLookupKey(route.method, `/api${route.path}`)
    legacyMap.set(key, route)
  }

  const newRoutes = parseNewRoutes()
  const { paths, unresolved } = buildSpec(newRoutes, legacyMap)

  if (unresolved.length) {
    console.error('Unresolved schemas or legacy matches:')
    unresolved.slice(0, 50).forEach((entry) => console.error(`- ${entry}`))
    if (unresolved.length > 50) {
      console.error(`...and ${unresolved.length - 50} more`)
    }
    process.exit(1)
  }

  const spec = {
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

  normalizeSchema(spec)

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
