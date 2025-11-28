const path = require('path')

const webExts = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js']

/**
 * @type {import('next').NextConfig}
 */
module.exports = {
  transpilePackages: [
    'app',
    '@legendapp/list',
    '@keepon/orpc',
    '@orpc/server',
  ],
  compiler: {
    define: {
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    },
  },
  webpack(config) {
    config.resolve = config.resolve || {}
    config.resolve.extensions = [...webExts, ...(config.resolve.extensions || [])]
    return config
  },
  turbopack: {
    root: path.resolve(__dirname, '../..'),
    resolveExtensions: [...webExts, '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.wasm'],
    rules: {
      'packages/app/**/*.{ts,tsx,js,jsx}': {
        as: '*.js',
        loaders: [
          {
            loader: 'babel-loader',
            options: {
              configFile: path.resolve(__dirname, 'babel.config.js'),
            },
          },
        ],
      },
      'packages/orpc/**/*.{ts,tsx,js,jsx}': {
        as: '*.js',
        loaders: [
          {
            loader: 'babel-loader',
            options: {
              configFile: path.resolve(__dirname, 'babel.config.js'),
            },
          },
        ],
      },
    },
  },
}
