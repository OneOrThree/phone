// Google 로그인 iOS URL scheme = iOS client ID 역방향.
// 값은 env(EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)에서 파생하며, 미설정 시 placeholder로 둔다(빌드는 통과, 실제 로그인은 값 주입 후 동작).
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace('.apps.googleusercontent.com', '')}`
  : 'com.googleusercontent.apps.PLACEHOLDER_IOS_CLIENT_ID';

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
      ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
      '@xmartlabs/react-native-line',
    ],
    slug: 'gromo-kr',
    version: '0.0.1',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    assetBundlePatterns: ['**/*', 'src/assets/models/*'],
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
