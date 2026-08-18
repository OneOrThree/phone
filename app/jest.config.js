// jest 설정 — 유닛(945)·컴포넌트(946)·모킹 유닛(948) 테스트 공용.
// 날짜·자정 경계 로직이 러너 시간대에 흔들리지 않도록 KST로 고정 — 워커 프로세스가 이 env를 물려받는다.
process.env.TZ = 'Asia/Seoul';

module.exports = {
  preset: 'jest-expo',
  // reanimated 4 — 워클릿 모듈이 네이티브(.native.ts) 구현을 잡으면 jest에서 터진다.
  // 공식 리졸버가 .native 확장자를 제외해 목 구현으로 붙게 한다(애니메이션 컴포넌트 렌더용).
  resolver: 'react-native-worklets/jest/resolver',
  // ios/(Pods) 등 대형 폴더 크롤링 방지 — 테스트는 src/ 안에만 둔다
  roots: ['<rootDir>/src'],
  // 전역 목(AsyncStorage 등) — 컴포넌트·컨텍스트·모킹 유닛 테스트 공용(GROMO-946·948)
  setupFiles: ['<rootDir>/jest.setup.js'],
  // 커버리지 측정 대상 — `npm run test:coverage`. jest 내장 기능이라 추가 의존성은 없다.
  // ⚠️ 이 배열이 있어야 **테스트가 없는 파일도 0%로 분모에 잡힌다.** 없으면 테스트가 건드린
  //    파일만 세서 수치가 실제보다 후하게 나온다.
  // 분모에서 빼는 것들 — 라이브 코드가 아니라 수치만 흐린다:
  //   legacy/ = v1 동결본(라이브에서 import 금지), mocks/ = dev 목킹, types/ = 타입 선언만.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/legacy/**',
    '!src/mocks/**',
    '!src/types/**',
    '!src/**/*.test.{ts,tsx}',
  ],
  // 임계값(coverageThreshold)은 일부러 안 건다 — 지금 걸면 CI가 바로 빨개진다.
  // 기준선(2026-08-13): statements 59.6% · branches 57.3% · functions 52.8% · lines 61.0%
  // 올릴 때 여기에 coverageThreshold: { global: { … } } 를 추가하면 게이트가 된다.
};
