import { loginProviders } from '@/services/loginProviders';

test.each([
  ['ios', false, ['google']],
  ['ios', true, ['apple', 'google']],
  ['android', false, ['google']],
  ['android', true, ['google']], // Android 에는 Apple 이 없다 — 공개 플래그와 무관
  ['web', false, []],
  ['web', true, []],
] as const)('%s / Apple 공개 플래그 %s → 애플·구글만', (platform, apple, expected) => {
  expect(loginProviders(platform, apple)).toEqual(expected);
});

test('지역과 무관하게 Kakao·LINE 은 노출하지 않는다', () => {
  for (const platform of ['ios', 'android'] as const) {
    expect(loginProviders(platform, true)).not.toEqual(expect.arrayContaining(['kakao']));
    expect(loginProviders(platform, true)).not.toEqual(expect.arrayContaining(['line']));
  }
});
