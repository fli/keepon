const REACT_SOURCE = 'react'

const TRANSITION_IMPORT = 'useTransition'
const START_TRANSITION_IMPORT = 'startTransition'

const STATE_HOOK_IMPORTS = new Set(['useState', 'useReducer', 'useOptimistic'])

const SCHEDULER_NAMES = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask'])
const GLOBAL_OBJECT_NAMES = new Set(['window', 'globalThis', 'global'])

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

const isFunctionLike = (node) => node?.type && FUNCTION_TYPES.has(node.type)

const isIdentifier = (node) => node?.type === 'Identifier'

const getNearestScopeNode = (node) => {
  let current = node
  while (current) {
    if (current.type === 'Program' || isFunctionLike(current)) {
      return current
    }
    current = current.parent
  }
  return null
}

const getParentScopeNode = (scopeNode) => {
  let current = scopeNode?.parent ?? null
  while (current) {
    if (current.type === 'Program' || isFunctionLike(current)) {
      return current
    }
    current = current.parent
  }
  return null
}

const buildScopeChain = (node) => {
  const chain = []
  let scopeNode = getNearestScopeNode(node)
  while (scopeNode) {
    chain.push(scopeNode)
    scopeNode = getParentScopeNode(scopeNode)
  }
  return chain
}

const registerNameInScope = (map, name, scopeNode) => {
  if (!name || !scopeNode) {
    return
  }
  if (!map.has(name)) {
    map.set(name, new Set())
  }
  map.get(name).add(scopeNode)
}

const isNameVisibleAtNode = (map, name, node) => {
  const scopes = map.get(name)
  if (!scopes || scopes.size === 0) {
    return false
  }
  const chainSet = new Set(buildScopeChain(node))
  for (const scopeNode of scopes) {
    if (chainSet.has(scopeNode)) {
      return true
    }
  }
  return false
}

const getVisibleNamesAtNode = (map, node) => {
  const visible = new Set()
  const chainSet = new Set(buildScopeChain(node))
  for (const [name, scopes] of map.entries()) {
    for (const scopeNode of scopes) {
      if (chainSet.has(scopeNode)) {
        visible.add(name)
        break
      }
    }
  }
  return visible
}

const getNodeStartIndex = (node, sourceCode) => {
  if (!node) {
    return 0
  }
  if (Array.isArray(node.range) && typeof node.range[0] === 'number') {
    return node.range[0]
  }
  if (typeof node.start === 'number') {
    return node.start
  }
  if (node.loc?.start && typeof sourceCode.getIndexFromLoc === 'function') {
    try {
      return sourceCode.getIndexFromLoc(node.loc.start)
    } catch {
      return 0
    }
  }
  return 0
}

const walk = (node, options) => {
  if (!node || typeof node.type !== 'string') {
    return
  }

  const {
    rootFunction,
    rootStartTransitionCall,
    skipNestedFunctions,
    skipNestedTransitions,
    onNode,
    isStartTransitionCall,
  } = options

  if (skipNestedFunctions && node !== rootFunction && isFunctionLike(node)) {
    return
  }

  if (
    skipNestedTransitions &&
    node !== rootStartTransitionCall &&
    node.type === 'CallExpression' &&
    isStartTransitionCall(node)
  ) {
    return
  }

  onNode?.(node)

  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue
    }
    const value = node[key]
    if (!value) {
      continue
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') {
          walk(child, options)
        }
      }
      continue
    }
    if (value && typeof value.type === 'string') {
      walk(value, options)
    }
  }
}

const getStartTransitionAction = (callExpression) => {
  const [firstArg] = callExpression.arguments ?? []
  if (!firstArg || !isFunctionLike(firstArg)) {
    return null
  }
  return firstArg
}

const getStartTransitionCalleeName = (callExpression) => {
  if (!callExpression || callExpression.type !== 'CallExpression') {
    return null
  }
  if (isIdentifier(callExpression.callee)) {
    return callExpression.callee.name
  }
  return null
}

const getSchedulerName = (callExpression) => {
  if (!callExpression || callExpression.type !== 'CallExpression') {
    return null
  }

  const callee = callExpression.callee
  if (isIdentifier(callee) && SCHEDULER_NAMES.has(callee.name)) {
    return callee.name
  }

  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    isIdentifier(callee.property) &&
    SCHEDULER_NAMES.has(callee.property.name) &&
    isIdentifier(callee.object) &&
    GLOBAL_OBJECT_NAMES.has(callee.object.name)
  ) {
    return callee.property.name
  }

  return null
}

const collectAwaitsAndSetters = ({
  node,
  rootFunction,
  rootStartTransitionCall,
  visibleSetters,
  sourceCode,
  isStartTransitionCall,
}) => {
  const awaitPositions = []
  const setterCalls = []

  walk(node, {
    rootFunction,
    rootStartTransitionCall,
    skipNestedFunctions: true,
    skipNestedTransitions: true,
    isStartTransitionCall,
    onNode(current) {
      if (current.type === 'AwaitExpression') {
        awaitPositions.push(getNodeStartIndex(current, sourceCode))
        return
      }

      if (current.type !== 'CallExpression') {
        return
      }
      if (!isIdentifier(current.callee)) {
        return
      }
      if (!visibleSetters.has(current.callee.name)) {
        return
      }

      setterCalls.push({
        node: current,
        name: current.callee.name,
        position: getNodeStartIndex(current, sourceCode),
      })
    },
  })

  return { awaitPositions, setterCalls }
}

const collectSettersInSchedulerCallback = ({
  schedulerCallback,
  rootFunction,
  rootStartTransitionCall,
  visibleSetters,
  sourceCode,
  isStartTransitionCall,
}) => {
  const setterCalls = []

  const callbackBody =
    schedulerCallback.body?.type === 'BlockStatement' ? schedulerCallback.body : (schedulerCallback.body ?? null)

  if (!callbackBody) {
    return setterCalls
  }

  walk(callbackBody, {
    rootFunction,
    rootStartTransitionCall,
    skipNestedFunctions: true,
    skipNestedTransitions: true,
    isStartTransitionCall,
    onNode(current) {
      if (current.type !== 'CallExpression') {
        return
      }
      if (!isIdentifier(current.callee)) {
        return
      }
      if (!visibleSetters.has(current.callee.name)) {
        return
      }

      setterCalls.push({
        node: current,
        name: current.callee.name,
        position: getNodeStartIndex(current, sourceCode),
      })
    },
  })

  return setterCalls
}

const createTransitionEnvironment = (context, reportHandlers) => {
  const sourceCode = context.sourceCode ?? context.getSourceCode()

  let programNode = null

  const useTransitionImportNames = new Set()
  const stateHookImportNames = new Set()

  const startTransitionScopes = new Map()
  const setterScopes = new Map()

  const isStartTransitionCall = (callExpression) => {
    const calleeName = getStartTransitionCalleeName(callExpression)
    if (!calleeName) {
      return false
    }
    return isNameVisibleAtNode(startTransitionScopes, calleeName, callExpression)
  }

  const registerStartTransitionName = (name, node) => {
    const scopeNode = getNearestScopeNode(node)
    registerNameInScope(startTransitionScopes, name, scopeNode)
  }

  const registerSetterName = (name, node) => {
    const scopeNode = getNearestScopeNode(node)
    registerNameInScope(setterScopes, name, scopeNode)
  }

  return {
    Program(node) {
      programNode = node
    },
    ImportDeclaration(node) {
      if (node.source?.value !== REACT_SOURCE) {
        return
      }
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== 'ImportSpecifier') {
          continue
        }
        const importedName = specifier.imported?.name
        const localName = specifier.local?.name
        if (!importedName || !localName) {
          continue
        }

        if (importedName === TRANSITION_IMPORT) {
          useTransitionImportNames.add(localName)
          continue
        }

        if (STATE_HOOK_IMPORTS.has(importedName)) {
          stateHookImportNames.add(localName)
          continue
        }

        if (importedName === START_TRANSITION_IMPORT) {
          registerNameInScope(startTransitionScopes, localName, programNode)
        }
      }
    },
    VariableDeclarator(node) {
      const init = node.init
      if (!init || init.type !== 'CallExpression') {
        return
      }
      if (!isIdentifier(init.callee)) {
        return
      }

      const calleeName = init.callee.name
      if (!node.id || node.id.type !== 'ArrayPattern') {
        return
      }

      const secondElement = node.id.elements?.[1]
      if (!isIdentifier(secondElement)) {
        return
      }

      if (useTransitionImportNames.has(calleeName)) {
        registerStartTransitionName(secondElement.name, node)
        return
      }

      if (stateHookImportNames.has(calleeName)) {
        registerSetterName(secondElement.name, node)
      }
    },
    CallExpression(node) {
      if (!isStartTransitionCall(node)) {
        return
      }
      const action = getStartTransitionAction(node)
      if (!action) {
        return
      }

      const visibleSetters = getVisibleNamesAtNode(setterScopes, action)
      if (visibleSetters.size === 0) {
        return
      }

      reportHandlers.handleStartTransition({
        node,
        action,
        visibleSetters,
        sourceCode,
        isStartTransitionCall,
      })
    },
  }
}

const noSettersAfterAwaitRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require state setters after await in startTransition actions to be wrapped in a nested startTransition call.',
      recommended: false,
    },
    schema: [],
    messages: {
      setterAfterAwait:
        "State setter '{{setter}}' runs after an await inside startTransition. Wrap it in a nested startTransition(() => …).",
    },
  },
  create(context) {
    const handleStartTransition = ({ node, action, visibleSetters, sourceCode, isStartTransitionCall }) => {
      const actionBody = action.body?.type === 'BlockStatement' ? action.body.body : [action.body].filter(Boolean)

      if (!actionBody || actionBody.length === 0) {
        return
      }

      let seenAwaitInPriorStatement = false

      for (const statement of actionBody) {
        const { awaitPositions, setterCalls } = collectAwaitsAndSetters({
          node: statement,
          rootFunction: action,
          rootStartTransitionCall: node,
          visibleSetters,
          sourceCode,
          isStartTransitionCall,
        })

        if (setterCalls.length === 0 && awaitPositions.length === 0) {
          continue
        }

        const firstAwaitPosition = awaitPositions.length > 0 ? Math.min(...awaitPositions) : Number.POSITIVE_INFINITY

        if (seenAwaitInPriorStatement) {
          for (const setterCall of setterCalls) {
            context.report({
              node: setterCall.node,
              messageId: 'setterAfterAwait',
              data: { setter: setterCall.name },
            })
          }
        } else if (awaitPositions.length > 0) {
          for (const setterCall of setterCalls) {
            if (setterCall.position > firstAwaitPosition) {
              context.report({
                node: setterCall.node,
                messageId: 'setterAfterAwait',
                data: { setter: setterCall.name },
              })
            }
          }
          seenAwaitInPriorStatement = true
        }
      }
    }

    return createTransitionEnvironment(context, { handleStartTransition })
  },
}

const noSettersInSchedulersRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow state setters inside scheduled callbacks nested under startTransition actions.',
      recommended: false,
    },
    schema: [],
    messages: {
      setterInScheduler:
        "State setter '{{setter}}' runs inside {{scheduler}} within startTransition. startTransition only covers synchronous updates; wrap the setter in another startTransition(() => …).",
    },
  },
  create(context) {
    const handleStartTransition = ({ node, action, visibleSetters, sourceCode, isStartTransitionCall }) => {
      const actionRoot = action.body?.type === 'BlockStatement' ? action.body : (action.body ?? null)
      if (!actionRoot) {
        return
      }

      walk(actionRoot, {
        rootFunction: action,
        rootStartTransitionCall: node,
        skipNestedFunctions: true,
        skipNestedTransitions: true,
        isStartTransitionCall,
        onNode(current) {
          if (current.type !== 'CallExpression') {
            return
          }
          const schedulerName = getSchedulerName(current)
          if (!schedulerName) {
            return
          }

          const [firstArg] = current.arguments ?? []
          if (!firstArg || !isFunctionLike(firstArg)) {
            return
          }

          const setterCalls = collectSettersInSchedulerCallback({
            schedulerCallback: firstArg,
            rootFunction: action,
            rootStartTransitionCall: node,
            visibleSetters,
            sourceCode,
            isStartTransitionCall,
          })

          for (const setterCall of setterCalls) {
            context.report({
              node: setterCall.node,
              messageId: 'setterInScheduler',
              data: {
                setter: setterCall.name,
                scheduler: schedulerName,
              },
            })
          }
        },
      })
    }

    return createTransitionEnvironment(context, { handleStartTransition })
  },
}

module.exports = {
  meta: {
    name: 'driah-react-transitions',
  },
  rules: {
    'no-setters-after-await': noSettersAfterAwaitRule,
    'no-setters-in-schedulers': noSettersInSchedulersRule,
  },
}
