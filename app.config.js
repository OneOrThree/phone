export default {
  expo: {
    name: 'otium',
    slug: 'otiun',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    assetBundlePatterns: ['**/*', 'assets/models/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.otium',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.oneorthree.otium',
    },
    web: {
      bundler: 'metro',
    },
    plugins: [
      'expo-dev-client',
      [
        '@react-native-kakao/core',
        {
          nativeAppKey: process.env.KAKAO_NATIVE_APP_KEY,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '47a51573-952b-4b0a-a7aa-43d6961c1785',
      },
    },
  },
};
