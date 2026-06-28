// Google 로그인 iOS URL scheme = iOS client ID 역방향.
// 값은 env(EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)에서 파생하며, 미설정 시 placeholder로 둔다(빌드는 통과, 실제 로그인은 값 주입 후 동작).
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace('.apps.googleusercontent.com', '')}`
  : 'com.googleusercontent.apps.PLACEHOLDER_IOS_CLIENT_ID';

// Meta(Facebook) — App ID/Client Token 은 env 에서 주입(미설정 시 prebuild 시 skip).
const facebookAppId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || '';
const facebookClientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN || '';

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
      // Facebook SDK 플러그인은 appID 가 있을 때만 추가한다.
      // (appID 가 비어 있으면 플러그인이 'missing appID' 로 throw 하므로 미설정 시 skip)
      ...(facebookAppId
        ? [
            [
              'react-native-fbsdk-next',
              {
                appID: facebookAppId,
                clientToken: facebookClientToken,
                displayName: 'gromo',
                scheme: `fb${facebookAppId}`,
              },
            ],
          ]
        : []),
    ],
    slug: 'gromo-kr',
    version: '0.0.5',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    assetBundlePatterns: ['**/*', 'src/assets/models/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.gromo',
      buildNumber: '21',
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
  },
};
