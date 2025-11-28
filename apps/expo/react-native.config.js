/**
 * React Native autolinking config for the Expo app.
 * Ensures NitroModules is discovered for codegen + iOS pods.
 */
module.exports = {
  dependencies: {
    'react-native-nitro-modules': {
      platforms: {
        ios: {
          // Podfile lives in apps/expo/ios, so point to the podspec from the app root.
          podspecPath:
            '../packages/app/node_modules/react-native-nitro-modules/NitroModules.podspec',
        },
      },
    },
  },
}
