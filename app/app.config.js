export default {
  expo: {
    name: 'gromo',
    plugins: [
      [
        '@react-native-kakao/core',
        {
          nativeAppKey: 'af3ff0c5b4fb9cd38b78428b88add65d',
          ios: { handleKakaoOpenUrl: true },
        },
      ],
    ],
    slug: 'gromo',
    version: '0.0.1',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    assetBundlePatterns: ['**/*', 'assets/models/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.gromo',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.oneorthree.gromo',
    },
    web: {
      bundler: 'metro',
    },
    owner: 'oscarthegrouch',
    extra: {
      eas: {
        projectId: 'd024fa23-5e52-4655-9705-2387d9289f19',
      },
    },
  },
};
