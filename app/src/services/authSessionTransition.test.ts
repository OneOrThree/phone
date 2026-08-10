import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import {
  acquireAuthSessionTransition,
  api,
  getFreshAccessToken,
  markAuthSessionReplacement,
  runAuthSessionTransition,
  setLogoutHandler,
} from './api';

const expiredAccessToken = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;

beforeEach(async () => {
  jest.restoreAllMocks();
  setLogoutHandler(null);
  await AsyncStorage.clear();
});

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

test('인증 전환 안의 만료 토큰 갱신은 보유한 mutex를 재사용한다', async () => {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, expiredAccessToken],
    [STORAGE_KEYS.refreshToken, 'guest-refresh'],
  ]);
  jest.spyOn(axios, 'post').mockResolvedValue({
    data: { accessToken: 'fresh-access', refreshToken: 'rotated-refresh' },
  });

  const token = await runAuthSessionTransition((lease) => getFreshAccessToken(lease));

  expect(token).toBe('fresh-access');
  expect(await AsyncStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('rotated-refresh');
});

test('이전 세션 refresh 폐기는 현재 세션 로그아웃으로 변환하지 않는다', async () => {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, expiredAccessToken],
    [STORAGE_KEYS.refreshToken, 'old-refresh'],
  ]);
  const logout = jest.fn();
  setLogoutHandler(logout);
  jest.spyOn(axios, 'post').mockImplementation(async () => {
    markAuthSessionReplacement();
    return { data: { accessToken: 'old-response-access' } };
  });

  await expect(
    api.get('/protected', {
      adapter: async (config) =>
        Promise.reject({
          config,
          response: { status: 401 },
        }),
    }),
  ).rejects.toThrow('stale auth refresh');

  expect(logout).not.toHaveBeenCalled();
});
