module.exports = {
  expo: {
    name: 'Focuscat',
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
      // 정적 이미지·오디오는 네이티브 바이너리에만 포함한다.
      // OTA는 JS 중심으로 배포하고 새 에셋 참조는 assets:verify로 검사한다.
      assetPatternsToBeBundled: ['src/assets/ota/**/*'],
    },
    extra: {
      eas: {
        projectId: 'b791fb8b-1f6c-4e6f-88f6-84ef0a99c79d',
      },
    },
    orientation: 'default',
    userInterfaceStyle: 'light',
    icon: './src/assets/icon.png',
    ios: {
      supportsTablet: true,
      // GROMO-1839 iPadOS 18 이하는 멀티태스킹을 지원하면 화면 방향 잠금을 무시하므로
      // 시작·가입 화면의 세로 고정을 위해 전체 화면을 요구한다. iPadOS 26은 Expo 패치로 대응한다
      requireFullScreen: true,
      bundleIdentifier: 'com.oneorthree.focuscat',
      infoPlist: {
        NSSupportsLiveActivities: true,
      },
      entitlements: {
        'com.apple.developer.family-controls': true,
        'com.apple.security.application-groups': ['group.com.oneorthree.focuscat'],
      },
    },
    android: {
      package: 'com.oneorthree.focuscat',
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
    plugins: ['expo-audio', 'expo-localization'],
  },
};
