// jest 설정(GROMO-945 1단계, 948에서 모킹 유닛 테스트 추가 — 컴포넌트 렌더 테스트는 아직 없음).
// 날짜·자정 경계 로직이 러너 시간대에 흔들리지 않도록 KST로 고정 — 워커 프로세스가 이 env를 물려받는다.
process.env.TZ = 'Asia/Seoul';

module.exports = {
  preset: 'jest-expo',
  // ios/(Pods) 등 대형 폴더 크롤링 방지 — 테스트는 src/ 안에만 둔다
  roots: ['<rootDir>/src'],
  // 공통 mock 연결(AsyncStorage 등, GROMO-948)
  setupFiles: ['<rootDir>/jest.setup.js'],
};
