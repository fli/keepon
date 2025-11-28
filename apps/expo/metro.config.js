// Learn more https://docs.expo.dev/guides/monorepos
// Learn more https://docs.expo.io/guides/customizing-metro
/**
 * @type {import('expo/metro-config')}
 */
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  // Allow Metro to resolve deps installed in shared packages
  path.resolve(workspaceRoot, 'packages', 'app', 'node_modules'),
]

// Let Metro walk up the directory tree (default) so it can follow the monorepo layout
// and find dependencies that live alongside the packages that declare them.
// Keeping this enabled avoids repeated "Unable to resolve" errors for nested deps.
config.resolver.disableHierarchicalLookup = false

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
})

module.exports = config
