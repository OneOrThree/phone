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
    // 앱 아이콘 소스(정사각 1024). prebuild 시 이 파일로 네이티브 AppIcon 세트를 생성한다.
    icon: './src/assets/icon.png',
    plugins: [
      // hot-updater OTA(GROMO-875) — prebuild 시 네이티브(AppDelegate·Info.plist·MainApplication·Manifest) 자동 반영.
      // 현재 ios/·android/는 직접 관리하므로 같은 변경을 수동으로도 넣어뒀다.
      ['@hot-updater/react-native', { channel: 'production' }],
      [
        '@react-native-kakao/core',
        {
          nativeAppKey: 'af3ff0c5b4fb9cd38b78428b88add65d',
          ios: { handleKakaoOpenUrl: true },
        },
      ],
      '@react-native-community/datetimepicker',
      'expo-apple-authentication',
      'expo-localization',
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
    scheme: 'gromo',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    assetBundlePatterns: ['**/*', 'src/assets/models/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oneorthree.gromo',
      buildNumber: '1',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Firebase 자동 화면추적 끄기 — RN에선 네이티브 뷰컨트롤러명(RNSScreen 등)만 잡혀 노이즈.
        // 화면 계측은 우리가 발행하는 커스텀 이벤트로만 관리한다.
        FirebaseAutomaticScreenReportingEnabled: false,
        // Screen Time(FamilyControls) 권한 사용 목적 — 시스템 팝업엔 안 뜨지만 심사 대비 명시
        NSFamilyControlsUsageDescription:
          '폰 사용 시간을 측정해 스크린타임 목표 달성 확인과 사용 통계 제공에 사용합니다.',
        // 공유 시트 '이미지 저장'(타임테이블 공유) — 네이티브 plist와 동기 유지(prebuild 시 유실 방지, 리뷰 반영)
        NSPhotoLibraryAddUsageDescription:
          '타임테이블 등 통계 이미지를 사진에 저장하기 위해 필요합니다.',
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
