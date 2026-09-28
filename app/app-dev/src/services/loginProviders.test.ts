import { loginProviders } from '@/services/loginProviders';

test.each([
  ['KR', 'ios', ['kakao', 'google']],
  ['kr', 'android', ['kakao', 'google']],
  ['JP', 'ios', ['line', 'google']],
  ['US', 'android', ['line', 'google']],
  ['ZZ', 'ios', ['line', 'google']],
  ['ZZ', 'android', ['line', 'google']],
  ['KR', 'web', []],
  ['US', 'web', []],
] as const)('%s / %s 로그인 제공자 순서', (region, platform, expected) => {
  expect(loginProviders(region, platform)).toEqual(expected);
});

test.each([
  ['KR', ['kakao', 'apple', 'google']],
  ['JP', ['line', 'apple', 'google']],
] as const)('%s / iOS Apple 로그인 공개 플래그 활성화', (region, expected) => {
  expect(loginProviders(region, 'ios', true)).toEqual(expected);
});

test('Apple 로그인 공개 플래그는 Android 제공자 목록을 바꾸지 않는다', () => {
  expect(loginProviders('KR', 'android', true)).toEqual(['kakao', 'google']);
});
