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
  const plist = fs.readFileSync(path.join(appDevRoot, 'ios/Cattus/Info.plist'), 'utf8');

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
    path.join(appDevRoot, 'ios/Cattus.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const fastfile = fs.readFileSync(path.join(appDevRoot, 'ios/fastlane/Fastfile'), 'utf8');
  const testflight = fs.readFileSync(path.join(appDevRoot, 'ios/testflight.sh'), 'utf8');

  expect(gradle).toMatch(
    /releaseArtifactTasks\s*=\s*\["assemblerelease", "bundlerelease", "packagerelease"\]/,
  );
  expect(gradle).toMatch(/termsVersion\s*==\s*null\s*\|\|\s*termsVersion\.trim\(\)\.isEmpty\(\)/);
  expect(gradle).toMatch(/includesReleaseArtifactTask\s*&&\s*\(termsVersion/);
  expect(gradle).toMatch(/apiUrl\s*!=\s*"https:\/\/catus-api\.oneorthree\.world"/);
  expect(gradle).toMatch(/includesReleaseArtifactTask\s*&&\s*!devAudience\s*&&\s*apiUrl\s*!=/);
  expect(xcode).toContain('${EXPO_PUBLIC_API_URL:-}');
  expect(xcode).toContain('https://catus-api.oneorthree.world');
  expect(fastfile).toContain('ENV["EXPO_PUBLIC_API_URL"] == "https://catus-api.oneorthree.world"');
  expect(testflight).toContain('EXPO_PUBLIC_API_URL:-}');
  expect(testflight).toContain('https://catus-api.oneorthree.world');
});

test('iOS dev TestFlight lane pins the team dev server and keeps the production gate', () => {
  const xcode = fs.readFileSync(
    path.join(appDevRoot, 'ios/Cattus.xcodeproj/project.pbxproj'),
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

test('Android CI builds the dev AAB and independent CD publishes only verified main CI artifacts', () => {
  const gradle = fs.readFileSync(path.join(appDevRoot, 'android/app/build.gradle'), 'utf8');
  const ci = fs.readFileSync(
    path.join(appDevRoot, '../../.github/workflows/app-android-ci.yml'),
    'utf8',
  );
  const cd = fs.readFileSync(
    path.join(appDevRoot, '../../.github/workflows/app-android-cd.yml'),
    'utf8',
  );

  // 청중 비면 prod. prod·dev 외 차단
  expect(gradle).toContain('System.getenv("GROMO_ANDROID_AUDIENCE") ?: "prod"');
  expect(gradle).toMatch(/!\(androidAudience in \["prod", "dev"\]\)/);
  // legacy 세션·운영 주소 가드는 운영만. dev 는 dev 주소만
  expect(gradle).toMatch(
    /!devAudience\s*&&\s*System\.getenv\("GROMO_LEGACY_SESSION_MIGRATION_READY"\)/,
  );
  expect(gradle).toMatch(/devAudience\s*&&\s*apiUrl\s*!=\s*"https:\/\/oneorthree\.dev\.mooo\.com"/);
  // CI 가 dev 주소·청중·RUM 환경명 고정
  expect(ci).toContain('EXPO_PUBLIC_API_URL: https://oneorthree.dev.mooo.com');
  expect(ci).toContain('GROMO_ANDROID_AUDIENCE: dev');
  expect(ci).toContain('EXPO_PUBLIC_ENV: dev');
  // 잡 하나의 본문 (2칸 들여쓰기 잡 이름 기준)
  const job = (workflow, name) => {
    const m = workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`));
    if (!m) throw new Error(`job ${name} 없음`);
    return m[1];
  };
  const settings = job(ci, 'settings');
  const build = job(ci, 'build');
  const source = job(cd, 'source');
  const sign = job(cd, 'sign');
  const deploy = job(cd, 'play-internal');
  // Play 업로드는 CD 만. 키 잡은 main 만
  expect(ci).not.toContain('upload-google-play');
  expect(cd).toContain('track: internal');
  expect(settings).toContain("github.ref == 'refs/heads/main'");
  expect(settings).toContain("needs.quality-gate.result == 'success'");
  expect(build).toContain("needs.settings.result == 'success'");
  expect(ci).not.toMatch(/^ {2}(sign|deploy):$/m);
  expect(ci).not.toContain('uses: ./.github/workflows/app-android-cd.yml');
  expect(build).toContain('android-ci-${{ github.run_id }}-${{ github.run_attempt }}');
  expect(source).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
  expect(source).toContain(
    'github.event.workflow_run.head_repository.id == github.event.repository.id',
  );
  expect(source).not.toContain('id-token: write');
  expect(source).toContain('android-cd-source.py');
  expect(source).toContain('android-artifact.py verify');
  expect(sign).toContain('needs: source');
  expect(sign.indexOf('android-artifact.py verify')).toBeLessThan(
    sign.indexOf('uses: aws-actions/configure-aws-credentials@'),
  );
  expect(deploy).toContain('needs: [source, sign]');
  expect(deploy).toContain('needs.source.outputs.version-code');
  // 의존성 코드는 Play·서명 키가 없는 build 잡에서만. 키 잡엔 안 돎
  expect(build).toContain('npm ci');
  expect(build).toContain('./gradlew');
  expect(build).not.toMatch(/id-token|aws-actions|RELEASE_SECRET_ID/);
  for (const keyJob of [settings, sign]) {
    expect(keyJob).toContain('id-token: write');
    expect(keyJob).not.toMatch(/npm |pip |gradlew|setup-node|setup-python/);
  }
  expect(cd).not.toMatch(/pip |setup-python/);
  // AAB 를 만드는 build 잡 액션도 커밋 SHA 고정
  expect(build).not.toMatch(/uses: [^\n]*@v\d/);
  // 재실행: 동일 versionCode의 업로드 바이트까지 검증한 경우만 업로드를 건너뛴다
  expect(cd).toContain('run: python3 .github/ci/play-verify-bundle.py');
  expect(cd).toContain("REQUIRE_PRESENT: '1'");
  expect(cd).toContain("if: steps.pre.outputs.present != 'true'");
  // 키 잡·CD 의 액션은 커밋 SHA 고정, 키 쓴 뒤 AWS 자격 증명 비움
  for (const keyJob of [settings, sign, cd]) {
    expect(keyJob).not.toMatch(/uses: [^\n]*@v\d/);
    expect(keyJob).toContain('AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN');
  }
  // 서명 검증은 jarsigner 출력으로. 업로드 키 지문 대조는 sign 잡
  expect(build).toContain("grep -q '^jar verified\\.'");
  expect(sign).toContain('"$ANDROID_UPLOAD_CERT_SHA1"');
  expect(cd).toContain(
    'ANDROID_UPLOAD_CERT_SHA1: 85:DF:F5:E4:96:1A:A2:32:88:E0:CF:B7:48:47:F0:55:9A:77:02:37',
  );
  // CD: 업로드 → 트랙 재조회 → 그다음 PR 표시
  expect(cd).toMatch(/업로드 확인 \(internal 트랙 재조회\)[\s\S]*배포된 PR 에 표시/);
  expect(cd).toContain('deployed:android-play-internal');
  expect(cd).toMatch(/r0adkll\/upload-google-play@[0-9a-f]{40}/);
  expect(cd).toMatch(/^on:\s*\n\s*workflow_run:/m);
  expect(cd).toContain('workflows: [Android CI]');
  expect(cd).toContain('branches: [main]');
  expect(cd).not.toMatch(/^\s+workflow_call:/m);
  expect(cd).toContain('ci-run-id:');
  // Play·서명 키는 Secrets Manager 에서만. 분석 업로드 키 하나만 main 빌드에 허용한다.
  expect(ci.match(/\bsecrets\.[A-Za-z_][A-Za-z0-9_]*/g)).toEqual(['secrets.POSTHOG_CLI_API_KEY']);
  expect(build).toContain(
    "POSTHOG_CLI_API_KEY: ${{ github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && secrets.POSTHOG_CLI_API_KEY || '' }}",
  );
  for (const keyJob of [settings, sign]) {
    expect(keyJob).not.toMatch(/secrets\./);
  }
  expect(cd).not.toMatch(/secrets\./);
  expect(ci).toContain('RELEASE_SECRET_ID: gromo/prod/android');
  // draft 는 배포 완료로 표시 안 함
  expect(cd).toContain('if [ "$STATUS" != completed ]; then');
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
    fs.readFileSync(path.join(appDevRoot, 'ios/Cattus.xcodeproj/project.pbxproj'), 'utf8'),
    'Check iOS release Apple audience readiness',
  );
  const prodUrl = 'https://catus-api.oneorthree.world';
  const devUrl = 'https://oneorthree.dev.mooo.com';
  // SRCROOT 는 .xcode.env 없는 빈 ios/ 폴더. 그 옆 src/config/googleClientIds.json 은 GROMO-2226 가드가 읽는다(기본: prod 채움).
  const run = (audience, apiUrl, { prodIds = { ios: 'p-ios', web: 'p-web' }, publicEnv } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gromo-gate-'));
    fs.mkdirSync(path.join(root, 'ios'));
    fs.mkdirSync(path.join(root, 'src/config'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src/config/googleClientIds.json'),
      JSON.stringify({ dev: { ios: 'd-ios', web: 'd-web' }, prod: prodIds }),
    );
    // publicEnv: null = 셸에 없음, '' = 빈 값, 생략 = 청중에 맞는 값(dev → dev, 그 외 → prod)
    const env =
      publicEnv === null ? undefined : (publicEnv ?? (audience === 'dev' ? 'dev' : 'prod'));
    return spawnSync('/bin/sh', ['-c', script], {
      env: {
        PATH: process.env.PATH,
        CONFIGURATION: 'Release',
        SRCROOT: path.join(root, 'ios'),
        EXPO_PUBLIC_TERMS_VERSION: '2026-09',
        EXPO_PUBLIC_APPLE_LOGIN_ENABLED: '1',
        EXPO_PUBLIC_API_URL: apiUrl,
        ...(audience === undefined ? {} : { GROMO_IOS_AUDIENCE: audience }),
        ...(env === undefined ? {} : { EXPO_PUBLIC_ENV: env }),
      },
      encoding: 'utf8',
    }).status;
  };

  // 미설정(=운영)·dev 외 값은 운영 주소만, dev 는 dev 주소만 통과한다
  expect(run(undefined, prodUrl)).toBe(0);
  expect(run(undefined, devUrl)).toBe(1);
  expect(run('prod', prodUrl)).toBe(0);
  expect(run('staging', devUrl)).toBe(1);
  expect(run('dev', devUrl)).toBe(0);
  expect(run('dev', prodUrl)).toBe(1);

  // GROMO-2226 — 운영 청중은 prod Google 클라이언트 id 가 둘 다 있어야 하고, dev 청중은 prod 칸이 비어도 된다
  const empty = { ios: '', web: '' };
  expect(run(undefined, prodUrl, { prodIds: empty })).toBe(1);
  expect(run('prod', prodUrl, { prodIds: { ios: 'p-ios', web: '' } })).toBe(1);
  expect(run('dev', devUrl, { prodIds: empty })).toBe(0);
  // 청중 ↔ EXPO_PUBLIC_ENV(JS 가 Google 행을 고르는 기준) 불일치는 양쪽 다 막는다
  expect(run('dev', devUrl, { publicEnv: 'prod' })).toBe(1);
  expect(run('prod', prodUrl, { publicEnv: 'dev' })).toBe(1);
  expect(run('prod', prodUrl, { publicEnv: 'prod' })).toBe(0);
  // Release 는 EXPO_PUBLIC_ENV 를 명시해야 한다 — 없거나 빈 값이면 청중과 무관하게 막는다(.env* 파일에 기대지 않음)
  expect(run('prod', prodUrl, { publicEnv: null })).toBe(1);
  expect(run(undefined, prodUrl, { publicEnv: '' })).toBe(1);
  expect(run('dev', devUrl, { publicEnv: null })).toBe(1);
});
