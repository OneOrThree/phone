import assert from 'node:assert/strict';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { clearSession, saveSession } from '@/services/api/session';

let captured: any;

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));

jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));

jest.mock('@/services/islandBoot', () => ({
  decideBootRoute: async () => 'login',
}));

jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(async () => {
  captured = undefined;
  await clearSession();
});

test('CurrentScreens에는 실제 공개 세션이 있을 때만 서버 섬·집중 명령을 주입한다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  assert.equal(captured.islands, undefined);
  assert.equal(captured.focus, undefined);

  await act(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  });
  await waitFor(() => assert.equal(typeof captured.islands?.create, 'function'));
  assert.equal(typeof captured.focus?.start, 'function');
  assert.equal(typeof captured.focus?.pause, 'function');
  assert.equal(typeof captured.focus?.resume, 'function');
  assert.equal(typeof captured.focus?.finish, 'function');

  await act(async () => {
    await clearSession();
  });
  await waitFor(() => assert.equal(captured.islands, undefined));
  assert.equal(captured.focus, undefined);
});
