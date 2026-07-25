// 로컬 config 플러그인 — expo prebuild가 android/를 재생성해도 아래 수동 배선이 자가 복구되게 한다 (GROMO-949).
// ① 카카오 SDK 전용 maven 저장소 주입 (@react-native-kakao 요구사항인데 카카오 플러그인이 직접 안 넣어줌)
// ② google-services gradle 플러그인 배선 (Firebase 설정 처리)
// ③ buildType별 google-services.json 배치 — firebase/ 원본(dev/prod)을 src/debug·src/release로 복사
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KAKAO_REPO = "maven { url 'https://devrepo.kakao.com/nexus/content/groups/public/' }";
const GMS_CLASSPATH = "classpath('com.google.gms:google-services:4.4.3')";
const GMS_APPLY = 'apply plugin: "com.google.gms.google-services"';

function withAndroidFirebaseKakao(config) {
  // ① + ② classpath: 루트 build.gradle
  config = withProjectBuildGradle(config, (c) => {
    let s = c.modResults.contents;
    if (!s.includes('devrepo.kakao.com')) {
      s = s.replace(
        /(maven \{ url 'https:\/\/www\.jitpack\.io' \})/,
        `$1\n    // 카카오 SDK 전용 저장소 — plugins/withAndroidFirebaseKakao.js가 주입 (GROMO-949)\n    ${KAKAO_REPO}`,
      );
    }
    if (!s.includes('com.google.gms:google-services')) {
      s = s.replace(
        /(classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\))/,
        `$1\n    // Firebase 설정 처리 — plugins/withAndroidFirebaseKakao.js가 주입 (GROMO-949)\n    ${GMS_CLASSPATH}`,
      );
    }
    c.modResults.contents = s;
    return c;
  });

  // ② apply: app/build.gradle
  config = withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('com.google.gms.google-services')) {
      c.modResults.contents = c.modResults.contents.replace(
        /(apply plugin: "com\.facebook\.react")/,
        `$1\n// google-services.json → 리소스 변환, src/debug(dev)·src/release(prod) 자동 선택 — plugins/withAndroidFirebaseKakao.js가 주입 (GROMO-949)\n${GMS_APPLY}`,
      );
    }
    return c;
  });

  // ③ buildType별 설정 파일 복사 (firebase/ 원본은 gitignore — 유실 시 Firebase 콘솔에서 재다운)
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const projectRoot = c.modRequest.projectRoot;
      const pairs = [
        ['firebase/google-services-dev.json', 'android/app/src/debug/google-services.json'],
        ['firebase/google-services-prod.json', 'android/app/src/release/google-services.json'],
      ];
      for (const [src, dst] of pairs) {
        const srcPath = path.join(projectRoot, src);
        const dstPath = path.join(projectRoot, dst);
        if (fs.existsSync(srcPath)) {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.copyFileSync(srcPath, dstPath);
        } else {
          // 원본이 없으면 이전 prebuild가 복사해둔 스테일 사본도 제거 — 낡은 설정(엉뚱한 Firebase
          // 프로젝트)으로 조용히 빌드되는 걸 막고, gradle이 "파일 없음"으로 명확히 실패하게 한다(코덱스 리뷰).
          fs.rmSync(dstPath, { force: true });
          console.warn(
            `[withAndroidFirebaseKakao] 원본 없음: ${src} — Firebase 콘솔에서 받아 firebase/에 두세요 (없으면 해당 buildType 빌드 실패)`,
          );
        }
      }
      return c;
    },
  ]);

  return config;
}

module.exports = withAndroidFirebaseKakao;
