import { acquireAuthSessionTransition } from './api';

test('인증 저장과 로그아웃 정리 구간은 동시에 진입하지 않는다', async () => {
  const releaseFirst = await acquireAuthSessionTransition();
  let secondEntered = false;
  const second = acquireAuthSessionTransition().then((release) => {
    secondEntered = true;
    return release;
  });

  await Promise.resolve();
  expect(secondEntered).toBe(false);

  releaseFirst();
  const releaseSecond = await second;
  expect(secondEntered).toBe(true);
  releaseSecond();
});
