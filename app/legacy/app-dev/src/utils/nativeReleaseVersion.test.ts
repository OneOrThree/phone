// 네이티브 릴리스 버전 정합 가드.
// expo-audio(네이티브 모듈)를 쓰기 시작한 뒤로 OTA(hot-updater, updateStrategy: 'appVersion')가
// 구/신 바이너리를 버전으로만 구분한다 — 네 곳 중 하나라도 어긋나면 expo-audio 없는 기존 바이너리에
// 새 번들이 내려가 크래시한다. Android versionCode 는 자동 증가 장치가 없어(iOS 는 fastlane 이 처리)
// versionName 만 올리고 잊는 사고가 실제로 났으므로 함께 고정한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..');
const read = (relPath: string) => readFileSync(join(APP_ROOT, relPath), 'utf8');

describe('네이티브 릴리스 버전', () => {
  const packageVersion = JSON.parse(read('package.json')).version as string;

  it('package.json·app.config.js·Android versionName·iOS MARKETING_VERSION 이 모두 같다', () => {
    const appConfigVersion = read('app.config.js').match(/^\s*version: '([^']+)',$/m)?.[1];
    const versionName = read('android/app/build.gradle').match(/versionName "([^"]+)"/)?.[1];
    const marketingVersions = [
      ...read('ios/gromo.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g),
    ].map((m) => m[1].trim());

    expect(appConfigVersion).toBe(packageVersion);
    expect(versionName).toBe(packageVersion);
    expect(marketingVersions.length).toBeGreaterThan(0);
    expect([...new Set(marketingVersions)]).toEqual([packageVersion]);
  });

  it('최초 릴리스(1.0.0) 이후라면 Android versionCode 도 올라가 있고 두 파일이 일치한다', () => {
    const gradleCode = Number(read('android/app/build.gradle').match(/versionCode (\d+)/)?.[1]);
    const configCode = Number(read('app.config.js').match(/versionCode: (\d+),/)?.[1]);

    expect(gradleCode).toBe(configCode);
    if (packageVersion !== '1.0.0') {
      // 같은 versionCode 로는 Play 업로드가 거부돼 네이티브 변경이 사용자에게 못 나간다.
      expect(gradleCode).toBeGreaterThan(1);
    }
  });
});
