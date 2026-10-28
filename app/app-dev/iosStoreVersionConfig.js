const { withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// iOS 스토어 버전은 app.config.js 의 version 과 다르다(GROMO-2398).
// version(2.0.0) 은 Android 가 동결된 1.x 패키지(com.oneorthree.gromo)를 잇는 값이고,
// App Store Connect 에 새로 만든 Cattus 앱(com.oneorthree.focuscat)은 1.0.2 부터 시작한다.
// prebuild 가 Info.plist 와 pbxproj 를 다시 쓸 때 Expo 의 withVersion 이 2.0.0 으로 되돌리므로
// 이 플러그인이 마지막에 1.0.2 로 덮어쓴다(앱 설정의 플러그인은 Expo 기본 플러그인보다 뒤에 실행된다).
const IOS_STORE_VERSION = '1.0.2';

function applyIosShortVersion(infoPlist) {
  infoPlist.CFBundleShortVersionString = IOS_STORE_VERSION;
  return infoPlist;
}

// 메인 앱과 확장 타겟 5개의 모든 빌드 구성에 같은 값을 쓴다 — 확장 Info.plist 는 $(MARKETING_VERSION) 을 참조한다.
function applyIosMarketingVersion(project) {
  const configurations = project.pbxXCBuildConfigurationSection();
  let touched = 0;
  for (const key of Object.keys(configurations)) {
    const buildSettings = configurations[key]?.buildSettings;
    if (buildSettings && 'MARKETING_VERSION' in buildSettings) {
      buildSettings.MARKETING_VERSION = IOS_STORE_VERSION;
      touched += 1;
    }
  }
  if (touched === 0) {
    throw new Error('MARKETING_VERSION build setting is missing from the Xcode project.');
  }
  return project;
}

function withIosStoreVersion(config) {
  const withShortVersion = withInfoPlist(config, (modConfig) => {
    modConfig.modResults = applyIosShortVersion(modConfig.modResults);
    return modConfig;
  });
  return withXcodeProject(withShortVersion, (modConfig) => {
    modConfig.modResults = applyIosMarketingVersion(modConfig.modResults);
    return modConfig;
  });
}

module.exports = {
  IOS_STORE_VERSION,
  applyIosMarketingVersion,
  applyIosShortVersion,
  withIosStoreVersion,
};
