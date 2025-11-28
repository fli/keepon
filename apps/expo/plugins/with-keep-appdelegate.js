const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const pluginName = 'with-keep-appdelegate'
const pluginVersion = '1.0.0'

const withKeepAppDelegate = (config) =>
  withDangerousMod(config, ['ios', (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot
    const platformRoot = modConfig.modRequest.platformProjectRoot
    const projectName = modConfig.modRequest.projectName

    if (!projectName) {
      throw new Error('[with-keep-appdelegate] Unable to resolve iOS project name')
    }

    const templatePath = path.join(projectRoot, 'plugins', 'AppDelegate.swift')
    if (!fs.existsSync(templatePath)) {
      throw new Error(`[with-keep-appdelegate] Missing template file at ${templatePath}`)
    }

    const targetPath = path.join(platformRoot, projectName, 'AppDelegate.swift')
    fs.copyFileSync(templatePath, targetPath)

    return modConfig
  }])

module.exports = createRunOncePlugin(withKeepAppDelegate, pluginName, pluginVersion)
