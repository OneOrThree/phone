// 날짜·자정 경계 로직이 러너 시간대에 흔들리지 않도록 KST로 고정한다.
process.env.TZ = 'Asia/Seoul';

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};
