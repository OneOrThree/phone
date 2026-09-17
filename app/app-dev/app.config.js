module.exports = {
  expo: {
    name: 'GROMO',
    slug: 'gromo-island-demo',
    version: '2.0.0',
    orientation: 'default',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.focuscat',
    },
    android: {
      package: 'com.oneorthree.focuscat',
    },
    web: {
      bundler: 'metro',
      favicon: './src/assets/reference-v2/avatar-black.png',
    },
    plugins: ['expo-audio'],
  },
};
