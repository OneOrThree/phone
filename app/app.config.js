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
      '@react-native-community/datetimepicker',
      'expo-apple-authentication',
    ],
    slug: 'gromo-kr',
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
    owner: 'oneorthree',
    extra: {
      eas: {
        projectId: '4958d398-2a53-42fb-978a-bdfc30a5f3c0',
      },
    },
  },
};
