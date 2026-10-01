const fs = require('node:fs');
const path = require('node:path');
const appConfig = require('../../app.config').expo;
const {
  ANDROID_KAKAO_KEY,
  ANDROID_KAKAO_SCHEME,
  ANDROID_PACKAGE,
  applyAndroidKakaoScheme,
} = require('../../kakaoAndroidConfig');

const appDevRoot = path.join(__dirname, '../..');

test('Android uses the 2.0 Kakao app identity and OAuth callback scheme', () => {
  expect(appConfig.android.package).toBe(ANDROID_PACKAGE);
  expect(ANDROID_KAKAO_KEY).toBe('1280641e9b639a279b7406f24b059703');

  const manifest = {
    manifest: {
      application: [
        {
          activity: [
            {
              $: { 'android:name': 'com.kakao.sdk.auth.AuthCodeHandlerActivity' },
              'intent-filter': [
                {
                  data: [{ $: { 'android:host': 'oauth', 'android:scheme': 'kakao-wrong' } }],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  applyAndroidKakaoScheme(manifest);
  expect(
    manifest.manifest.application[0].activity[0]['intent-filter'][0].data[0].$['android:scheme'],
  ).toBe(ANDROID_KAKAO_SCHEME);

  const checkedInManifest = fs.readFileSync(
    path.join(appDevRoot, 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  expect(checkedInManifest).toContain(`android:scheme="${ANDROID_KAKAO_SCHEME}"`);
  expect(fs.readFileSync(path.join(appDevRoot, 'index.native.ts'), 'utf8')).toMatch(
    /initializeKakaoSDK\('1280641e9b639a279b7406f24b059703'\)/,
  );
});

test('iOS uses the 2.0 Kakao key and callback scheme for the focuscat bundle', () => {
  const iosKey = '1280641e9b639a279b7406f24b059703';
  const kakaoPlugin = appConfig.plugins.find(([name]) => name === '@react-native-kakao/core');
  const plist = fs.readFileSync(path.join(appDevRoot, 'ios/GROMO/Info.plist'), 'utf8');

  expect(appConfig.ios.bundleIdentifier).toBe('com.oneorthree.focuscat');
  expect(kakaoPlugin[1].nativeAppKey).toBe(iosKey);
  expect(plist).toContain(`<string>kakao${iosKey}</string>`);
  expect(fs.readFileSync(path.join(appDevRoot, 'index.native.ts'), 'utf8')).toMatch(
    /initializeKakaoSDK\('1280641e9b639a279b7406f24b059703'\)/,
  );
});

test('Android/iOS release require real terms and the production API URL', () => {
  const gradle = fs.readFileSync(path.join(appDevRoot, 'android/app/build.gradle'), 'utf8');
  const xcode = fs.readFileSync(
    path.join(appDevRoot, 'ios/GROMO.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const fastfile = fs.readFileSync(path.join(appDevRoot, 'ios/fastlane/Fastfile'), 'utf8');
  const testflight = fs.readFileSync(path.join(appDevRoot, 'ios/testflight.sh'), 'utf8');

  expect(gradle).toMatch(
    /releaseArtifactTasks\s*=\s*\["assemblerelease", "bundlerelease", "packagerelease"\]/,
  );
  expect(gradle).toMatch(/termsVersion\s*==\s*null\s*\|\|\s*termsVersion\.trim\(\)\.isEmpty\(\)/);
  expect(gradle).toMatch(/includesReleaseArtifactTask\s*&&\s*\(termsVersion/);
  expect(gradle).toMatch(/apiUrl\s*!=\s*"https:\/\/api\.oneorthree\.world"/);
  expect(gradle).toMatch(/includesReleaseArtifactTask\s*&&\s*apiUrl\s*!=/);
  expect(xcode).toContain('${EXPO_PUBLIC_API_URL:-}');
  expect(xcode).toContain('https://api.oneorthree.world');
  expect(fastfile).toContain('ENV["EXPO_PUBLIC_API_URL"] == "https://api.oneorthree.world"');
  expect(testflight).toContain('EXPO_PUBLIC_API_URL:-}');
  expect(testflight).toContain('https://api.oneorthree.world');
});
