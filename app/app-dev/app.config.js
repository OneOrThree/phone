// 2.0 전용 카카오 앱의 네이티브 키다(LOGIN-D02). 카카오 사용자 ID는 카카오 앱마다 다르므로 1.x 카카오
// 가입자는 2.0에서 새 계정이 된다 — 1.x 미이관 정책과 같은 방향으로 수용한 결정이다.
const kakaoNativeAppKey = '1280641e9b639a279b7406f24b059703';
const { withLegacyAndroidKakao } = require('./kakaoAndroidConfig');
// iOS 스토어 버전(1.0.2)은 아래 version(2.0.0, Android 용)과 다르다 — 이유는 iosStoreVersionConfig.js
const { withIosStoreVersion } = require('./iosStoreVersionConfig');
// GROMO-2215·2226 — 구글 클라이언트 id 정본은 src/config/googleClientIds.json 이다(socialLogin.ts 와 같은 파일).
// 여기서는 expo prebuild 가 Info.plist 에 심을 URL 스킴만 dev.ios 에서 만든다(이 레포는 체크인된 ios/ 를 쓴다).
// 체크인된 Info.plist 에는 dev·prod 스킴을 둘 다 등록한다(규칙은 src/config/googleClientIds.md).
const googleIosClientId = require('./src/config/googleClientIds.json').dev.ios;
const googleIosUrlScheme = `com.googleusercontent.apps.${googleIosClientId.replace(
  '.apps.googleusercontent.com',
  '',
)}`;

module.exports = {
  expo: {
    name: 'catus',
    slug: 'focuscat',
    owner: 'oneorthree',
    version: '2.0.0',
    runtimeVersion: '2.0.0',
    updates: {
      url: 'https://u.expo.dev/b791fb8b-1f6c-4e6f-88f6-84ef0a99c79d',
      requestHeaders: {
        'expo-channel-name': 'production',
      },
      fallbackToCacheTimeout: 0,
      enableBsdiffPatchSupport: true,
      // `src/assets/ota/**` 만 OTA 업데이트에 싣는다. 그 밖의 에셋은 바이너리에만 있으니
      // 새 그림은 ota/ 아래에 둔다(README 「문구·이미지 추가 규칙」). 자동 검사는 없다.
      assetPatternsToBeBundled: ['src/assets/ota/**/*'],
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
      versionCode: 20,
      // 집중 차단 기능이 있는 기존 Android OTA와 네이티브 구성을 분리한다.
      runtimeVersion: '2.0.0-no-special-use',
      permissions: ['android.permission.PACKAGE_USAGE_STATS'],
      blockedPermissions: [
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      ],
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
      // prebuild 전용 입력 — 체크인된 ios/GROMO/Info.plist 가 실제 스킴 정본이다(위 주석)
      ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
      '@xmartlabs/react-native-line',
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
