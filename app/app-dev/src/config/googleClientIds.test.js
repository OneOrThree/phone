// GROMO-2226 — 구글 클라이언트 id 의 정본(googleClientIds.json)과 그 값을 따로 들고 있는 곳들이 어긋나지 않는지 본다.
const fs = require('node:fs');
const path = require('node:path');
const appConfig = require('../../app.config').expo;
const ids = require('./googleClientIds.json');

const appDevRoot = path.join(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(appDevRoot, relativePath), 'utf8');

const SUFFIX = '.apps.googleusercontent.com';
// iOS URL 스킴 = 클라이언트 id 를 뒤집은 값(구글 로그인 SDK 규칙)
const schemeOf = (iosClientId) => `com.googleusercontent.apps.${iosClientId.replace(SUFFIX, '')}`;
const projectOf = (clientId) => clientId.match(/^(\d+)-/)?.[1];

test('Info.plist 의 GoogleSignIn 스킴은 JSON 에 채워진 iOS id 를 뒤집은 값과 정확히 같다', () => {
  const plist = read('ios/GROMO/Info.plist');
  const block = plist.match(
    /<string>GoogleSignIn<\/string>\s*<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  expect(block).not.toBeNull();
  const registered = [...block[1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]).sort();

  // prod 가 채워지면 dev·prod 둘 다 있어야 한다 — OTA 로 JS 만 바뀌어도 Release 에서 스킴 불일치 크래시가 없게.
  const expected = [ids.dev.ios, ids.prod.ios].filter(Boolean).map(schemeOf).sort();
  expect(expected.length).toBeGreaterThan(0);
  expect(registered).toEqual(expected);
});

test('app.config 의 구글 플러그인 iosUrlScheme 은 dev iOS id 를 뒤집은 값이다', () => {
  const plugin = appConfig.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === '@react-native-google-signin/google-signin',
  );
  expect(plugin[1].iosUrlScheme).toBe(schemeOf(ids.dev.ios));
});

test('행마다 iOS·Web 이 같은 프로젝트에 속하고 prod 는 dev 와 다른 프로젝트다', () => {
  expect(ids.dev.ios).toMatch(/^\d+-.+\.apps\.googleusercontent\.com$/);
  expect(ids.dev.web).toMatch(/^\d+-.+\.apps\.googleusercontent\.com$/);
  expect(projectOf(ids.dev.ios)).toBe(projectOf(ids.dev.web));

  // prod 는 둘 다 비었거나(미발급) 둘 다 채워져야 한다 — 하나만 채워진 반쪽 상태는 가드도 막는다.
  expect(Boolean(ids.prod.ios)).toBe(Boolean(ids.prod.web));
  if (ids.prod.ios) {
    expect(ids.prod.ios).toMatch(/^\d+-.+\.apps\.googleusercontent\.com$/);
    expect(ids.prod.web).toMatch(/^\d+-.+\.apps\.googleusercontent\.com$/);
    expect(projectOf(ids.prod.ios)).toBe(projectOf(ids.prod.web));
    expect(projectOf(ids.prod.ios)).not.toBe(projectOf(ids.dev.ios));
  }
});

test('클라이언트 id 리터럴과 Web id env 덮어쓰기는 JSON 밖에 두지 않는다', () => {
  const socialLogin = read('src/services/socialLogin.ts');
  expect(socialLogin).not.toContain('googleusercontent');
  expect(socialLogin).not.toContain('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  expect(read('.env.example')).not.toMatch(/^EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=/m);
  // app.config.js 도 id 를 직접 들고 있지 않고 JSON 에서 읽는다.
  expect(read('app.config.js')).not.toMatch(/\d{6,}-\w+\.apps\.googleusercontent\.com/);
  expect(read('app.config.js')).toContain("require('./src/config/googleClientIds.json')");
});

test('운영 빌드 경로(TestFlight 레인·OTA·Xcode Release 단계·Android release)는 prod 칸이 비면 중단한다', () => {
  const guard = (cwdRelativeJson) =>
    new RegExp(
      `require\\('${cwdRelativeJson}'\\)\\.prod;[^\\n]*\\n\\s*echo "[^\\n]*운영 Google 클라이언트 id 미발급[^\\n]*\\n\\s*exit 1`,
    );

  const testflight = read('ios/testflight.sh');
  expect(testflight).toMatch(guard('\\.\\./src/config/googleClientIds\\.json'));
  // 운영 분기 안(dev 분기 else 앞)에 있어야 --dev 빌드가 막히지 않는다.
  const prodStart = testflight.indexOf('if [[ "$AUDIENCE" == "prod" ]]; then');
  const devStart = testflight.indexOf('\nelse\n', prodStart);
  const guardAt = testflight.indexOf('googleClientIds.json');
  expect(prodStart).toBeGreaterThan(-1);
  expect(guardAt).toBeGreaterThan(prodStart);
  expect(guardAt).toBeLessThan(devStart);

  expect(read('scripts/ota-update.sh')).toMatch(guard('\\./src/config/googleClientIds\\.json'));

  // Xcode Release 아카이브 단계(「Check iOS release Apple audience readiness」)에도 같은 가드 — testflight.sh 를 거치지 않는
  // fastlane 직접 실행·Xcode 아카이브를 막는다. dev 청중(GROMO_IOS_AUDIENCE=dev)은 통과.
  const gradle = read('android/app/build.gradle');
  const pbxproj = read('ios/GROMO.xcodeproj/project.pbxproj');
  expect(pbxproj).toContain(
    '[ \\"${GROMO_IOS_AUDIENCE:-prod}\\" != \\"dev\\" ] && ! \\"${NODE_BINARY:-node}\\" -e \\"const g=require(\'$SRCROOT/../src/config/googleClientIds.json\').prod; process.exit(g.ios && g.web ? 0 : 1)\\"',
  );
  expect(pbxproj).toContain('error: iOS release 차단: 운영 Google 클라이언트 id 미발급');
  // 청중 ↔ EXPO_PUBLIC_ENV 일치 검사(Xcode 단계는 kakaoAndroidConfig.test 가 실제 sh 로 돈다; gradle 은 문자열로)
  expect(gradle).toContain(
    'if (includesReleaseArtifactTask && devAudience && publicEnv != "dev") {',
  );
  expect(gradle).toContain(
    'if (includesReleaseArtifactTask && !devAudience && publicEnv == "dev") {',
  );

  // fastlane beta(운영)는 EXPO_PUBLIC_ENV 를 prod 로 고정한다 — 셸에 값이 없을 때 Expo 가 .env 의 dev 를 인라인하는 틈을 막는다.
  const fastfile = read('ios/fastlane/Fastfile');
  const betaLane = fastfile.slice(fastfile.indexOf('lane :beta do'), fastfile.indexOf('lane :beta_dev do'));
  expect(betaLane).toContain('ENV["EXPO_PUBLIC_ENV"] = "prod"');

  // Android 운영 release(assemble/bundle/packageRelease)도 같은 가드 — dev 청중(!devAudience 가 거짓)은 통과.
  expect(gradle).toMatch(
    /if \(includesReleaseArtifactTask && !devAudience\) \{\s*\n\s*def googleIds = new groovy\.json\.JsonSlurper\(\)\.parse\(new File\(rootDir, "\.\.\/src\/config\/googleClientIds\.json"\)\)\s*\n\s*if \(!googleIds\.prod\?\.web\?\.trim\(\)\) \{\s*\n\s*throw new GradleException\(\s*\n\s*"Android release 차단: 운영 Google 클라이언트 id 미발급/,
  );
});
