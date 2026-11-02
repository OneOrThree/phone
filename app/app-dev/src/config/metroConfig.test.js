// GROMO-2671 — 변환 캐시 키에 EXPO_PUBLIC_* 값이 없으면 앞선 빌드의 dev 값이 다음 운영 번들에 실린다.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
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

// 번들 태스크가 UP-TO-DATE 로 건너뛰면 Metro 까지 가지 않는다. Xcode 번들 단계는 alwaysOutOfDate 라 해당하지 않는다.
test('Android JS 번들 태스크는 EXPO_PUBLIC_* 값과 .env 파일을 입력으로 선언한다', () => {
  const gradle = fs.readFileSync(path.join(__dirname, '../../android/app/build.gradle'), 'utf8');
  // 번들 태스크 이름 끝까지 맞춘다. PostHog 정리 태스크(Delete)에 입력이 붙으면 main 빌드가 실패한다(GROMO-2667).
  expect(gradle).toContain('tasks.matching { it.name ==~ /createBundle\\w*JsAndAssets/ }');
  expect(gradle).toContain('inputs.property("expoPublicEnv"');
  expect(gradle).toContain('includes: [".env*"]');
});
