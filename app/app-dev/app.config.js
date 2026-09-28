const kakaoNativeAppKey =
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY || '1280641e9b639a279b7406f24b059703';
const googleIosClientId =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  '899365616896-4c2hdm77a2d0vt9ntctpcsjj457u5eop.apps.googleusercontent.com';
const googleIosUrlScheme = `com.googleusercontent.apps.${googleIosClientId.replace(
  '.apps.googleusercontent.com',
  '',
)}`;

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
      usesAppleSignIn: true,
      // GROMO-1839 iPadOS 18 이하는 멀티태스킹을 지원하면 화면 방향 잠금을 무시하므로
      // 시작·가입 화면의 세로 고정을 위해 전체 화면을 요구한다. iPadOS 26은 Expo 패치로 대응한다
      requireFullScreen: true,
      bundleIdentifier: 'com.oneorthree.focuscat',
      infoPlist: {
        CFBundleLocalizations: ['ko', 'en'],
        NSSupportsLiveActivities: true,
      },
      entitlements: {
        'com.apple.developer.family-controls': true,
        'com.apple.security.application-groups': ['group.com.oneorthree.focuscat'],
      },
    },
    android: {
      package: 'com.oneorthree.gromo',
      versionCode: 2,
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
    plugins: [
      'expo-audio',
      'expo-localization',
      'expo-apple-authentication',
      [
        '@react-native-kakao/core',
        {
          nativeAppKey: kakaoNativeAppKey,
          ios: { handleKakaoOpenUrl: true },
          android: { authCodeHandlerActivity: true },
        },
      ],
      ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
      '@xmartlabs/react-native-line',
    ],
  },
};
