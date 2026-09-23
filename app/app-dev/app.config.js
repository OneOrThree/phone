module.exports = {
  expo: {
    name: 'GROMO',
    slug: 'gromo-island-demo',
    version: '2.0.0',
    orientation: 'default',
    userInterfaceStyle: 'light',
    icon: './src/assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.focuscat',
      entitlements: {
        'com.apple.developer.family-controls': true,
        'com.apple.security.application-groups': ['group.com.oneorthree.focuscat'],
      },
    },
    android: {
      package: 'com.oneorthree.focuscat',
      permissions: ['android.permission.PACKAGE_USAGE_STATS'],
      adaptiveIcon: {
        image: './src/assets/icon.png',
        backgroundColor: '#FDEFD5',
      },
    },
    web: {
      bundler: 'metro',
      favicon: './src/assets/reference-v2/avatar-black.png',
    },
    plugins: ['expo-audio', 'expo-localization'],
  },
};
