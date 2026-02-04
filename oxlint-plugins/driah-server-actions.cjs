const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const pnpmRoot = path.join(repoRoot, 'node_modules', '.pnpm')

const readDirSafe = (dir) => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

const resolvePnpmPackage = (prefix, packagePath) => {
  const entries = readDirSafe(pnpmRoot)
  const match = entries.find((name) => name.startsWith(`${prefix}@`))
  if (!match) {
    return null
  }
  return path.join(pnpmRoot, match, 'node_modules', packagePath)
}

const resolveDependency = (packageName, pnpmPrefix, pnpmPath) => {
  try {
    return require(packageName)
  } catch {
    const pnpmResolved = resolvePnpmPackage(pnpmPrefix, pnpmPath)
    if (!pnpmResolved) {
      throw new Error(`Unable to resolve ${packageName}. Install it or ensure pnpm store exists.`)
    }
    return require(pnpmResolved)
  }
}

const babel = resolveDependency('@babel/core', '@babel+core', '@babel/core')
const reactCompiler = resolveDependency(
  'babel-plugin-react-compiler',
  'babel-plugin-react-compiler',
  'babel-plugin-react-compiler'
)

const REACT_COMPILER_PARSER_PLUGINS = [
  'jsx',
  'typescript',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'dynamicImport',
  'importMeta',
  'topLevelAwait',
  'decorators-legacy',
]

const reactCompilerCheck = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Run the React Compiler and surface compiler errors as lint failures.',
      recommended: false,
    },
    schema: [],
    messages: {
      compilerError: 'React Compiler: {{reason}}',
      parseError: 'React Compiler parse error: {{message}}',
    },
  },
  create(context) {
    let didRun = false

    const toLoc = (loc) => {
      if (!loc || typeof loc.line !== 'number' || typeof loc.column !== 'number') {
        return undefined
      }
      return {
        start: { line: loc.line, column: loc.column },
        end: { line: loc.line, column: loc.column },
      }
    }

    return {
      Program(node) {
        if (didRun) {
          return
        }
        didRun = true

        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const code = sourceCode.text
        const filename = context.getFilename?.() ?? '<unknown>'
        const events = []
        const logger = {
          logEvent: (_filename, event) => {
            events.push(event)
          },
        }

        try {
          babel.transformSync(code, {
            filename,
            configFile: false,
            babelrc: false,
            parserOpts: {
              sourceType: 'module',
              plugins: REACT_COMPILER_PARSER_PLUGINS,
            },
            plugins: [
              [
                reactCompiler,
                {
                  logger,
                  panicThreshold: 'all_errors',
                },
              ],
            ],
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const loc = toLoc(error?.loc)
          context.report({
            node,
            loc,
            messageId: 'parseError',
            data: { message },
          })
          return
        }

        const compileErrors = events.filter((event) => event?.kind === 'CompileError')
        for (const compilerError of compileErrors) {
          const detail = compilerError?.detail?.options
          const reason = detail?.reason ?? 'Unknown reason'
          const loc = toLoc(detail?.details?.[0]?.loc?.start)
          context.report({
            node,
            loc,
            messageId: 'compilerError',
            data: { reason },
          })
        }
      },
    }
  },
}

module.exports = {
  meta: {
    name: 'driah-server-actions',
  },
  rules: {
    'react-compiler-check': reactCompilerCheck,
  },
}
