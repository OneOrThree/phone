import { needsAppleAuthorizationCode } from './withdrawalIntent';

describe('needsAppleAuthorizationCode', () => {
  test('provider 가 없어도 서버 연동 목록에 apple 이 있으면 받는다 (2026-10-22 전 세션)', () => {
    expect(needsAppleAuthorizationCode('ios', undefined, ['apple'])).toBe(true);
  });

  test('연동 목록을 아직 못 읽었어도 세션 provider 가 apple 이면 받는다', () => {
    expect(needsAppleAuthorizationCode('ios', 'apple', undefined)).toBe(true);
  });

  test('apple 이 아닌 연동만 있으면 받지 않는다', () => {
    expect(needsAppleAuthorizationCode('ios', 'google', ['google', 'kakao'])).toBe(false);
  });

  test('게스트(연동 없음)는 받지 않는다', () => {
    expect(needsAppleAuthorizationCode('ios', undefined, [])).toBe(false);
  });

  test('여러 연동 중 apple 이 있으면 받는다', () => {
    expect(needsAppleAuthorizationCode('ios', undefined, ['apple', 'google'])).toBe(true);
  });

  test('Android 는 Apple 재인증을 열지 않는다', () => {
    expect(needsAppleAuthorizationCode('android', 'apple', ['apple'])).toBe(false);
  });
});
