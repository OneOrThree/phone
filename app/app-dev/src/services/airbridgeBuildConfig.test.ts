/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = path.resolve(__dirname, '../../scripts/airbridge-ios-build-config.cjs');
const token = 'a'.repeat(32);
let directory: string;
let output: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'airbridge-ios-test-'));
  output = path.join(directory, 'AirbridgeConfig.json');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function build(configuration: string, variables: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, output], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_NO_DOTENV: '1',
      CONFIGURATION: configuration,
      AIRBRIDGE_APP_TOKEN: token,
      EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED: '0',
      EXPO_PUBLIC_DEMO: '0',
      ...variables,
    },
  });
}

test.each(['', 'YOUR_APP_TOKEN'])(
  '토큰 %s인 Release는 실패하고 이전 산출물도 제거한다',
  (appToken) => {
    writeFileSync(output, 'stale-token');
    const result = build('Release', { AIRBRIDGE_APP_TOKEN: appToken });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('iOS release 차단');
    expect(existsSync(output)).toBe(false);
  },
);

test.each<[string, Record<string, string>, boolean]>([
  ['Debug', {}, false],
  ['Debug', { EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED: '1' }, true],
  ['Debug', { AIRBRIDGE_APP_TOKEN: '' }, false],
  ['Release', {}, true],
  ['Release', { EXPO_PUBLIC_DEMO: '1' }, false],
])(
  '%s 빌드의 개발·데모 조건에 맞춰 SDK와 ATT 활성화를 결정한다',
  (configuration, variables, enabled) => {
    const result = build(configuration, variables);
    expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(output, 'utf8'));
    expect(config).toEqual({
      appName: 'catus',
      appToken: variables.AIRBRIDGE_APP_TOKEN ?? token,
      enabled,
    });
    expect(result.stdout).not.toContain(token);
    expect(result.stderr).not.toContain(token);
  },
);
