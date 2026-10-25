// 날짜·자정 경계 로직이 러너 시간대에 흔들리지 않도록 KST로 고정한다.
process.env.TZ = 'Asia/Seoul';

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // 번들 타일셋은 Metro 의 @2x 배율 해석으로만 찾힌다(TileTerrainCanvas — `tileset.png` → `tileset@2x.png`).
  // iOS·Android 가 늘 타일 섬이 된 뒤(GROMO-2476) 홈을 그리는 테스트가 모두 이 require 를 타서 같은 해석을 여기 둔다.
  moduleNameMapper: {
    'village-world/v1/tileset(-night)?\\.png$':
      '<rootDir>/src/assets/village-world/v1/tileset$1@2x.png',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};
