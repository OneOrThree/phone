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
    extra: {
      eas: {
        projectId: '47a51573-952b-4b0a-a7aa-43d6961c1785',
      },
    },
  },
};
