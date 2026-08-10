import { acquireAuthSessionTransition, runAuthSessionTransition } from './api';

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

test('인증 작업은 provider 시작부터 세션 저장 완료까지 mutex를 소유한다', async () => {
  let finishAuth!: () => void;
  const authBlocked = new Promise<void>((resolve) => {
    finishAuth = resolve;
  });
  const calls: string[] = [];

  const auth = runAuthSessionTransition(async () => {
    calls.push('provider-start');
    await authBlocked;
    calls.push('session-saved');
  });
  const logout = acquireAuthSessionTransition().then((release) => {
    calls.push('logout-start');
    release();
  });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['provider-start']);

  finishAuth();
  await Promise.all([auth, logout]);
  expect(calls).toEqual(['provider-start', 'session-saved', 'logout-start']);
});
