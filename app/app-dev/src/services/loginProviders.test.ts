import { loginProviders } from '@/services/loginProviders';

test.each([
  ['KR', 'ios', ['kakao', 'apple', 'google']],
  ['kr', 'android', ['kakao', 'google']],
  ['JP', 'ios', ['line', 'apple', 'google']],
  ['US', 'android', ['line', 'google']],
  ['ZZ', 'ios', ['line', 'apple', 'google']],
  ['ZZ', 'android', ['line', 'google']],
  ['KR', 'web', []],
  ['US', 'web', []],
] as const)('%s / %s 로그인 제공자 순서', (region, platform, expected) => {
  expect(loginProviders(region, platform)).toEqual(expected);
});
