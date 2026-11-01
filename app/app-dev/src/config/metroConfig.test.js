// GROMO-2671 — 변환 캐시 키에 EXPO_PUBLIC_* 값이 없으면 앞선 빌드의 dev 값이 다음 운영 번들에 실린다.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// jest 안에서는 expo/metro-config 를 불러올 수 없어 Metro 처럼 node 로 설정 파일을 읽는다
const cacheVersionWith = (env) =>
  execFileSync(process.execPath, ['-p', "require('./metro.config').cacheVersion"], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, EXPO_PUBLIC_ENV: env },
    encoding: 'utf8',
  });

test('EXPO_PUBLIC_* 값이 다르면 Metro 캐시를 나눠 쓰고 같으면 함께 쓴다', () => {
  const prod = cacheVersionWith('prod');
  expect(prod).toContain('EXPO_PUBLIC_ENV=prod');
  expect(cacheVersionWith('dev')).not.toBe(prod);
  expect(cacheVersionWith('prod')).toBe(prod);
}, 60_000);
