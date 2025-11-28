module.exports = function (api) {
  api.cache(true)

  return {
    presets: [['next/babel']],
    plugins: [
      // Allow parsing Flow syntax used inside react-native (e.g. `import typeof`).
      '@babel/plugin-transform-flow-strip-types',
      'react-native-worklets/plugin',
    ],
  }
}
