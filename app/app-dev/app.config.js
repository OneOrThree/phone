// 2.0 전용 카카오 앱의 네이티브 키다(LOGIN-D02). 카카오 사용자 ID는 카카오 앱마다 다르므로 1.x 카카오
// 가입자는 2.0에서 새 계정이 된다 — 1.x 미이관 정책과 같은 방향으로 수용한 결정이다.
const kakaoNativeAppKey = '1280641e9b639a279b7406f24b059703';
const { withLegacyAndroidKakao } = require('./kakaoAndroidConfig');
// iOS 스토어 버전은 아래 version(Android 용)과 따로 관리한다 — 이유와 현재 값은 iosStoreVersionConfig.js
const { withIosStoreVersion } = require('./iosStoreVersionConfig');
const { withIosMeta } = require('./metaIosConfig');
// GROMO-2215·2226 — 구글 클라이언트 id 정본은 src/config/googleClientIds.json 이다(socialLogin.ts 와 같은 파일).
// 여기서는 expo prebuild 가 Info.plist 에 심을 URL 스킴만 dev.ios 에서 만든다(이 레포는 체크인된 ios/ 를 쓴다).
// 체크인된 Info.plist 에는 dev·prod 의 서로 다른 스킴을 모두 등록한다(현재는 같은 스킴 하나, 규칙은 src/config/googleClientIds.md).
const googleIosClientId = require('./src/config/googleClientIds.json').dev.ios;
const googleIosUrlScheme = `com.googleusercontent.apps.${googleIosClientId.replace(
  '.apps.googleusercontent.com',
  '',
)}`;

module.exports = {
  expo: {
    name: 'cattus',
    // 홈 화면·권한 창 이름 — 한국어 기기 집중할고양, 그 외 cattus(GROMO-2458). ios/Cattus/Supporting/*.lproj/InfoPlist.strings 와 같은 값
    locales: { ko: './locales/ko.json', en: './locales/en.json' },
    slug: 'focuscat',
    owner: 'oneorthree',
    version: '2.3.2',
    runtimeVersion: '2.0.0',
    updates: {
      url: 'https://u.expo.dev/b791fb8b-1f6c-4e6f-88f6-84ef0a99c79d',
      requestHeaders: {
        'expo-channel-name': 'production',
      },
      fallbackToCacheTimeout: 0,
      enableBsdiffPatchSupport: true,
      // `src/assets/ota/**` 와 AI 판정 모델 `src/assets/ml/**` 만 OTA 업데이트에 싣는다. 그 밖의 에셋은 바이너리에만 있으니
      // 새 그림은 ota/ 아래에 둔다(README 「문구·이미지 추가 규칙」). 자동 검사는 없다.
      // ml/ 을 빼면 모델을 바꾼 JS 가 OTA 로 나갈 때 구 바이너리에서 새 .tflite 를 못 찾아 AI 측정이 깨진다(GROMO-2879).
      assetPatternsToBeBundled: ['src/assets/ota/**/*', 'src/assets/ml/**/*'],
    },
    extra: {
      eas: {
        projectId: 'b791fb8b-1f6c-4e6f-88f6-84ef0a99c79d',
      },
    },
    orientation: 'default',
    scheme: 'gromo',
    userInterfaceStyle: 'light',
    icon: './src/assets/icon.png',
    ios: {
      supportsTablet: true,
      usesAppleSignIn: true,
      // GROMO-1839 iPadOS 18 이하는 멀티태스킹을 지원하면 화면 방향 잠금을 무시하므로
      // 시작·가입 화면의 세로 고정을 위해 전체 화면을 요구한다. iPadOS 26은 Expo 패치로 대응한다
      requireFullScreen: true,
      bundleIdentifier: 'com.oneorthree.gromo',
      associatedDomains: [
        'applinks:link.oneorthree.world',
        'applinks:catus-api-v2.oneorthree.world',
        'applinks:oneorthree-v2.dev.mooo.com',
      ],
      // GROMO-2523·2544 푸시·Meta SDK가 든 바이너리만 새 JS OTA를 받게 iOS 런타임을 분리한다.
      // gromo 번들 바이너리는 Google 클라이언트 스킴이 focuscat 바이너리와 달라 같은 OTA 를 받으면
      // 로그인 탭에서 크래시하므로 런타임을 또 가른다(옛 focuscat 빌드는 2.0.0-push-meta-assets-ai-focus-meta-events-v1).
      // 스토어 2.3.0·2.3.1(2.0.0-gromo-push-meta-assets-*)은 카메라 네이티브 모듈이 없어 AI 집중 인증 JS 를 받으면 안 된다 — 값을 공유하지 않는다.
      // 체크인된 ios/Cattus/Supporting/Expo.plist 의 EXUpdatesRuntimeVersion 과 같은 값이어야 한다.
      // GROMO-2756 새 Meta 앱 ID·Client Token을 포함한 바이너리만 같은 OTA를 받는다.
      // GROMO-2783 expo-store-review 는 런타임을 올리지 않았다 — services/storeReview.ts 의 늦은 require 가 모듈 없는
      // 옛 바이너리를 지킨다. 다른 JS 가 이 모듈에 기대게 되면 그때 런타임을 가른다(Android 런타임도 같다).
      runtimeVersion: '2.0.0-screen-time-setup-v1',
      infoPlist: {
        CFBundleLocalizations: ['ko', 'en'],
        NSSupportsLiveActivities: true,
        NSCameraUsageDescription:
          '집중 중 책상이 보이는지 기기 안에서만 확인합니다. 사진은 저장·전송되지 않습니다.',
      },
      entitlements: {
        'com.apple.developer.family-controls': true,
        'com.apple.security.application-groups': ['group.com.oneorthree.gromo'],
      },
    },
    android: {
      package: 'com.oneorthree.gromo',
      versionCode: 379,
      // 집중 차단 기능이 있는 기존 Android OTA와 네이티브 구성을 분리한다.
      // GROMO-2756 새 Meta 앱 ID·Client Token을 포함한 바이너리만 같은 OTA를 받는다.
      runtimeVersion: '2.0.1-android-focus-return-v1',
      permissions: [
        'android.permission.PACKAGE_USAGE_STATS',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.CAMERA',
      ],
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      ],
      intentFilters: [
        'link.oneorthree.world',
        'catus-api-v2.oneorthree.world',
        'oneorthree-v2.dev.mooo.com',
      ].map((host) => ({
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host, pathPrefix: '/l/' }],
      })),
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
      ['expo-camera', { microphonePermission: false, recordAudioAndroid: false }],
      [withIosMeta],
      // 현재 음원은 앱 안에서만 재생하므로 미디어 포그라운드 서비스를 추가하지 않는다.
      [
        'expo-audio',
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
        },
      ],
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
      withLegacyAndroidKakao,
      withIosStoreVersion,
      // prebuild 전용 입력 — 체크인된 ios/Cattus/Info.plist 가 실제 스킴 정본이다(위 주석)
      ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
      '@xmartlabs/react-native-line',
      // 크래시·오류 수집(services/sentry.ts). 네이티브 프로젝트가 체크인돼 있어 이 config plugin 은 prebuild 때만 쓰이고
      // 빌드에는 아무것도 넣지 않는다. 소스맵·mapping·dSYM 업로드는 android/app/build.gradle 과 scripts/sentry-xcode.sh 가
      // SENTRY_AUTH_TOKEN 이 있을 때 한다(GROMO-2739). 토큰을 여기 적으면 앱 패키지에 노출되므로 적지 않는다.
      '@sentry/react-native',
      // GROMO-2380 고운돋움을 앱에 넣어 첫 화면부터 글꼴을 기다리지 않는다(웹만 useFonts 로 불러온다).
      // iOS는 글꼴 파일 속 가족 이름(Gowun Dodum), 안드로이드는 아래 등록 이름(Gowun)으로 찾는다 — sceneKit 의 GOWUN
      // 안드로이드를 xml 글꼴로 등록해야 굵게(700 이상)도 시스템 글꼴로 바뀌지 않고 고운돋움을 굵게 그린다
      [
        'expo-font',
        {
          ios: { fonts: ['./src/assets/fonts/gowun-dodum.ttf'] },
          android: {
            fonts: [
              {
                fontFamily: 'Gowun',
                fontDefinitions: [{ path: './src/assets/fonts/gowun-dodum.ttf', weight: 400 }],
              },
            ],
          },
        },
      ],
    ],
  },
};
