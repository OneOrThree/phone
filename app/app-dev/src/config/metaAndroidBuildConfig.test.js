const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const metaApp = require('./metaApp.json');

// Gradle과 같은 별도 Node 프로세스로 실행해 JSON 출력과 CI의 빈 변수 처리를 검증한다.
function buildConfig(overrides = {}) {
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  delete env.META_CLIENT_TOKEN;
  delete env.META_DEV_ENABLED;
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/meta-build-config.cjs')],
    { env: { ...env, ...overrides }, encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test.each([undefined, '', '   '])(
  'CI 토큰이 %p이면 공용 Meta 토큰으로 설치 수집을 설정한다',
  (clientToken) => {
    const config = buildConfig(clientToken === undefined ? {} : { META_CLIENT_TOKEN: clientToken });
    expect(config.clientToken).toBeTruthy();
    expect(config.clientToken).toBe(metaApp.clientToken);
    expect(config.devEnabled).toBe(false);
  },
);

test('명시한 토큰과 개발 수집 설정을 빌드에 전달한다', () => {
  expect(buildConfig({ META_CLIENT_TOKEN: ' test-client-token ', META_DEV_ENABLED: '1' })).toEqual({
    clientToken: 'test-client-token',
    devEnabled: true,
  });
});

// 생성 설정과 체크인된 네이티브 프로젝트가 서로 다른 Meta 앱을 가리키지 않게 한다.
test('iOS·Android 네이티브 설정은 공용 Meta 앱과 같은 ID·토큰을 사용한다', () => {
  const appRoot = path.resolve(__dirname, '../..');
  const ios = fs.readFileSync(path.join(appRoot, 'ios/Cattus/Info.plist'), 'utf8');
  const android = fs.readFileSync(
    path.join(appRoot, 'android/app/src/main/res/values/strings.xml'),
    'utf8',
  );
  const iosId = ios.match(/<key>FacebookAppID<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const iosToken = ios.match(/<key>FacebookClientToken<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const androidId = android.match(/<string name="facebook_app_id"[^>]*>([^<]+)<\/string>/)?.[1];
  expect(iosId).toBe(metaApp.appId);
  expect(androidId).toBe(metaApp.appId);
  // 토큰 원문을 실패 출력에 남기지 않는다.
  expect(iosToken === metaApp.clientToken).toBe(true);
  const expo = require('../../app.config').expo;
  expect(expo.ios.runtimeVersion).not.toBe('2.0.0-gromo-push-meta-assets-ai-focus-meta-events-v2');
  expect(expo.android.runtimeVersion).not.toBe('2.0.1-android-push-assets-ai-focus-meta-events-v3');
});
