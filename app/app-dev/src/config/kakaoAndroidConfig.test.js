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

test('iOS dev TestFlight lane pins the team dev server and keeps the production gate', () => {
  const xcode = fs.readFileSync(
    path.join(appDevRoot, 'ios/GROMO.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const fastfile = fs.readFileSync(path.join(appDevRoot, 'ios/fastlane/Fastfile'), 'utf8');
  const testflight = fs.readFileSync(path.join(appDevRoot, 'ios/testflight.sh'), 'utf8');
  const client = fs.readFileSync(path.join(appDevRoot, 'src/services/api/client.ts'), 'utf8');
  const posthog = fs.readFileSync(path.join(appDevRoot, 'src/services/posthog.ts'), 'utf8');

  // dev 주소는 앱 코드(client.ts)와 lane 이 같은 값을 써야 한다
  expect(client).toContain("DEV_API_URL = 'https://oneorthree.dev.mooo.com'");
  expect(fastfile).toContain('DEV_API_URL = "https://oneorthree.dev.mooo.com"');
  // dev lane 은 환경변수를 믿지 않고 서버 주소·청중·RUM 환경명을 직접 고정한다(||= 아님)
  expect(fastfile).toContain('lane :beta_dev');
  expect(fastfile).toContain('ENV["EXPO_PUBLIC_API_URL"] = DEV_API_URL');
  expect(fastfile).toContain('ENV["GROMO_IOS_AUDIENCE"] = "dev"');
  expect(fastfile).toContain('ENV["EXPO_PUBLIC_ENV"] = "dev"');
  expect(fastfile).not.toMatch(/lane :beta_dev[\s\S]*\|\|=/);
  // 운영 lane 도 청중을 직접 고정한다 — 셸에 남은 GROMO_IOS_AUDIENCE=dev 가 운영 빌드에 새지 않게
  expect(fastfile).toMatch(
    /lane :beta do[\s\S]*ENV\["GROMO_IOS_AUDIENCE"\] = "prod"[\s\S]*lane :beta_dev/,
  );
  // dev 빌드는 운영 OTA 채널을 공유하므로 업데이트를 끈 채 아카이브하고, PostHog 는 빈 토큰으로 끈다
  expect(fastfile).toContain('plist["EXUpdatesEnabled"] = false');
  expect(fastfile).toContain('ENV["EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN"] = ""');
  // 빈 토큰으로 끄는 방식은 posthog.ts 의 두 조건에 기댄다 — 바뀌면 lane 쪽도 같이 봐야 한다
  expect(posthog).toContain('process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN ??');
  expect(posthog).toContain('if (client || !projectToken || !host) return;');
  // Xcode gate 는 dev 청중일 때만 dev 주소를 허용하고, 그때 운영 주소는 막는다
  expect(xcode).toContain('${GROMO_IOS_AUDIENCE:-prod}');
  expect(xcode).toContain('https://oneorthree.dev.mooo.com');
  // 실행 스크립트의 --dev 도 같은 주소를 고정하고 dev lane 을 부른다
  expect(testflight).toContain('--dev');
  expect(testflight).toContain('export EXPO_PUBLIC_API_URL="https://oneorthree.dev.mooo.com"');
  expect(testflight).toContain('fastlane beta_dev');
});

// pbxproj 는 스크립트 단계 본문을 \n·\" 로 이스케이프해 한 줄에 담는다 — 그걸 풀어 실제 sh 로 돌려 본다
function xcodeShellScript(pbxproj, phaseName) {
  const section = pbxproj.split(`/* ${phaseName} */ = {`)[1];
  const escaped = section.match(/shellScript = "((?:[^"\\]|\\.)*)";/)[1];
  return escaped.replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch));
}

test('iOS release gate script allows only the matching audience/API URL pair', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const script = xcodeShellScript(
    fs.readFileSync(path.join(appDevRoot, 'ios/GROMO.xcodeproj/project.pbxproj'), 'utf8'),
    'Check iOS release Apple audience readiness',
  );
  const prodUrl = 'https://api.oneorthree.world';
  const devUrl = 'https://oneorthree.dev.mooo.com';
  const run = (audience, apiUrl) =>
    spawnSync('/bin/sh', ['-c', script], {
      env: {
        PATH: process.env.PATH,
        CONFIGURATION: 'Release',
        SRCROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'gromo-gate-')), // .xcode.env 없는 빈 폴더
        EXPO_PUBLIC_TERMS_VERSION: '2026-09',
        EXPO_PUBLIC_APPLE_LOGIN_ENABLED: '1',
        EXPO_PUBLIC_API_URL: apiUrl,
        ...(audience === undefined ? {} : { GROMO_IOS_AUDIENCE: audience }),
      },
      encoding: 'utf8',
    }).status;

  // 미설정(=운영)·dev 외 값은 운영 주소만, dev 는 dev 주소만 통과한다
  expect(run(undefined, prodUrl)).toBe(0);
  expect(run(undefined, devUrl)).toBe(1);
  expect(run('prod', prodUrl)).toBe(0);
  expect(run('staging', devUrl)).toBe(1);
  expect(run('dev', devUrl)).toBe(0);
  expect(run('dev', prodUrl)).toBe(1);
});
