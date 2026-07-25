// jest 설정 — 유닛(945)·컴포넌트(946)·모킹 유닛(948) 테스트 공용.
// 날짜·자정 경계 로직이 러너 시간대에 흔들리지 않도록 KST로 고정 — 워커 프로세스가 이 env를 물려받는다.
process.env.TZ = 'Asia/Seoul';

module.exports = {
  preset: 'jest-expo',
  // ios/(Pods) 등 대형 폴더 크롤링 방지 — 테스트는 src/ 안에만 둔다
  roots: ['<rootDir>/src'],
  // 전역 목(AsyncStorage 등) — 컴포넌트·컨텍스트·모킹 유닛 테스트 공용(GROMO-946·948)
  setupFiles: ['<rootDir>/jest.setup.js'],
};
