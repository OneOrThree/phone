const { spawnSync } = require('node:child_process');
const path = require('node:path');
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
