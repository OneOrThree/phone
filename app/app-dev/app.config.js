module.exports = {
  expo: {
    name: 'GROMO',
    slug: 'gromo-island-demo',
    version: '2.0.0',
    orientation: 'default',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      // GROMO-1839 iPadOS 18 이하는 멀티태스킹을 지원하면 화면 방향 잠금을 무시하므로
      // 시작·가입 화면의 세로 고정을 위해 전체 화면을 요구한다. iPadOS 26은 Expo 패치로 대응한다
      requireFullScreen: true,
      bundleIdentifier: 'com.oneorthree.focuscat',
    },
    android: {
      package: 'com.oneorthree.focuscat',
    },
    web: {
      bundler: 'metro',
      favicon: './src/assets/reference-v2/avatar-black.png',
    },
    plugins: ['expo-audio'],
  },
};
