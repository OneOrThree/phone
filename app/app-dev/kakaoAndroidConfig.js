const { withAndroidManifest } = require('expo/config-plugins');

const ANDROID_PACKAGE = 'com.oneorthree.gromo';
const ANDROID_KAKAO_KEY = 'af3ff0c5b4fb9cd38b78428b88add65d';
const ANDROID_KAKAO_SCHEME = `kakao${ANDROID_KAKAO_KEY}`;

function applyAndroidKakaoScheme(manifest) {
  const application = manifest.manifest.application?.[0];
  const activity = application?.activity?.find(
    ({ $ }) => $['android:name'] === 'com.kakao.sdk.auth.AuthCodeHandlerActivity',
  );

  if (!activity) {
    throw new Error('Android Kakao AuthCodeHandlerActivity is missing from the manifest.');
  }

  const viewFilter = activity['intent-filter']?.find((filter) =>
    filter.data?.some(({ $ }) => $['android:host'] === 'oauth'),
  );

  if (!viewFilter) {
    throw new Error('Android Kakao OAuth callback filter is missing from the manifest.');
  }

  const oauthData = viewFilter.data.find(({ $ }) => $['android:host'] === 'oauth');
  oauthData.$['android:scheme'] = ANDROID_KAKAO_SCHEME;
  return manifest;
}

function withLegacyAndroidKakao(config) {
  if (config.android?.package !== ANDROID_PACKAGE) {
    throw new Error(`Android Kakao identity requires package ${ANDROID_PACKAGE}.`);
  }

  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyAndroidKakaoScheme(modConfig.modResults);
    return modConfig;
  });
}

module.exports = {
  ANDROID_KAKAO_KEY,
  ANDROID_KAKAO_SCHEME,
  ANDROID_PACKAGE,
  applyAndroidKakaoScheme,
  withLegacyAndroidKakao,
};
