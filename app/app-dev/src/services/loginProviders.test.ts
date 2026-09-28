import { loginProviders } from '@/services/loginProviders';

test.each([
  ['ko', 'ios', ['kakao', 'apple', 'google']],
  ['KO', 'android', ['kakao', 'google']],
  ['ja', 'ios', ['line', 'apple', 'google']],
  ['en', 'android', ['line', 'google']],
  [undefined, 'ios', ['line', 'apple', 'google']],
  [undefined, 'android', ['line', 'google']],
  ['ko', 'web', []],
  ['en', 'web', []],
] as const)('%s / %s 로그인 제공자 순서', (language, platform, expected) => {
  expect(loginProviders(language, platform)).toEqual(expected);
});
