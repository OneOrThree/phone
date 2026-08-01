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
          // 로그인 후 kakao{앱키}://oauth 복귀 액티비티 — prebuild 재생성 시 Manifest에 자동 주입 (수동 관리 중인 android/에도 동일 설정 반영돼 있음)
          android: { authCodeHandlerActivity: true },
        },
      ],
      '@react-native-community/datetimepicker',
      'expo-apple-authentication',
      'expo-localization',
      ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
      '@xmartlabs/react-native-line',
      // ATT(앱 추적 투명성) 동의 팝업 — prebuild 시 Info.plist 문구를 동기화한다(현재는 네이티브에 직접 반영됨).
      [
        'expo-tracking-transparency',
        {
          userTrackingPermission:
            '광고 성과 측정을 위해 사용돼요. 허용하지 않아도 앱 이용에는 영향이 없어요.',
        },
      ],
      // Facebook SDK 플러그인은 appID 가 있을 때만 추가한다.
      // (appID 가 비어 있으면 플러그인이 'missing appID' 로 throw 하므로 미설정 시 skip)
      // 주의: prebuild 시 이 플러그인이 Info.plist를 단일 값으로 재생성해, 네이티브의
      // Debug/Release별 변수 치환($(FACEBOOK_APP_ID) — dev/prod 데이터 세트 분리)이 사라진다.
      // ios/는 수동 관리를 유지하고, prebuild 했다면 Info.plist 3곳(AppID·ClientToken·URL스킴)을 복원할 것.
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
    version: '1.0.0',
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
        // 앨범에서 사진 고르기(오브젝트 캐릭터 스파이크) — 네이티브 plist와 동기 유지
        NSPhotoLibraryUsageDescription:
          '사진 속 물건으로 캐릭터를 만들기 위해 앨범에서 사진을 고를 때 필요합니다.',
      },
    },
    android: {
      package: 'com.oneorthree.gromo',
      // 어댑티브 아이콘(prebuild 시 네이티브 반영) — 전경은 세이프존(중앙 66%)에 아트를 두고
      // 여백은 투명, 배경색은 icon.png 테두리 평균색(보라). 수동 관리 중인 android/ res에도 동일 반영돼 있음.
      adaptiveIcon: {
        foregroundImage: './src/assets/adaptive-icon.png',
        backgroundColor: '#9288CB',
      },
    },
    web: {
      bundler: 'metro',
    },
    owner: 'oneorthree',
  },
};
