/**
 * GROMO-2617 — 실제 App 경로의 강제 업데이트 편지. getAppRequirements 만 모의한다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, BackHandler, Linking, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import * as notices from '@/services/api/developerNotices';
import { letterSeenKey, STORE_URLS } from '@/services/developerLetter';
import * as ScreenOrientation from 'expo-screen-orientation';
import { initialState, reducer } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

let captured: any;
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.2' }));
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/api/developerNotices', () => ({
  listDeveloperNotices: jest.fn(async () => ({ items: [] })),
  getAppRequirements: jest.fn(),
}));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => undefined),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', DEFAULT: 'DEFAULT' },
}));
jest.mock('@/utils/layout', () => {
  const actual = jest.requireActual('@/utils/layout');
  return {
    ...actual,
    useAppLayout: () => ({ ...actual.useAppLayout(), tablet: false, width: 390, height: 844 }),
  };
});
jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));
jest.mock('@/services/islandBoot', () => ({ decideBootRoute: async () => 'login' }));
jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const get = notices.getAppRequirements as jest.Mock;
const list = notices.listDeveloperNotices as jest.Mock;
const requirement = {
  minVersion: '1.0.10',
  title: '새 버전이 나왔어요',
  body: '업데이트가 필요해요',
  publicationId: 'p',
  publishedAt: '2026-10-30T00:00:00Z',
};
const backHandlers: (() => boolean)[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  captured = undefined;
  backHandlers.length = 0;
  (AppState as any).currentState = 'active';
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, h: () => boolean) => {
    backHandlers.push(h);
    return { remove: jest.fn() };
  }) as never);
  await AsyncStorage.clear();
  await clearSession();
});

test('로그아웃 상태 로그인 화면에서도 뜨고 뒤로 가기로 닫히지 않으며 버튼이 스토어를 연다', async () => {
  get.mockResolvedValue(requirement);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  assert.equal(captured.letterOpen, true);
  const back = backHandlers[backHandlers.length - 1];
  await act(async () => assert.equal(back(), true));
  assert.ok(screen.queryByTestId('developer-letter'));
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter-confirm')));
  assert.equal(screen.queryByText('업데이트하러 가기') !== null, true);
  await fireEvent.press(screen.getByTestId('developer-letter-confirm'));
  expect(open).toHaveBeenCalledWith(STORE_URLS[Platform.OS === 'ios' ? 'ios' : 'android']);
  assert.ok(screen.queryByTestId('developer-letter'));
  expect(list).not.toHaveBeenCalled();
});

test('조회가 끝나지 않아도 앱은 뜬다', async () => {
  get.mockReturnValue(new Promise(() => {}));
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  assert.equal(screen.queryByTestId('developer-letter'), null);
});

test('응답이 통과면 편지가 없다', async () => {
  get.mockResolvedValue({ ...requirement, minVersion: null });
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => expect(get).toHaveBeenCalled());
  assert.equal(screen.queryByTestId('developer-letter'), null);
});

const lock = ScreenOrientation.lockAsync as jest.Mock;

test('집중 세션이 있으면 요구가 있어도 안 뜨고 패치노트도 조회하지 않으며, 세션이 끝나면 뜬다', async () => {
  get.mockResolvedValue(requirement);
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await act(async () =>
    captured.dispatch({
      type: 'LOAD',
      state: reducer(initialState(true), { type: 'START', subject: '집중', now: Date.now() }),
      now: Date.now(),
    }),
  );
  await waitFor(() => assert.ok(captured.state.session));
  await waitFor(() => assert.equal(screen.queryByTestId('developer-letter'), null));
  assert.equal(captured.letterOpen, false);
  expect(list).not.toHaveBeenCalled();
  await act(async () => captured.dispatch({ type: 'FINISH' }));
  await waitFor(() => assert.equal(captured.state.session, null));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  expect(list).not.toHaveBeenCalled();
});

test('폰에서 강제 편지가 뜨면 마지막 잠금이 PORTRAIT_UP 이다', async () => {
  get.mockResolvedValue(requirement);
  const screen = await render(<App />);
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await waitFor(() => expect(lock).toHaveBeenLastCalledWith('PORTRAIT_UP'));
});

test('패치노트가 떠 있는 중 강제 요구가 오면 강제 편지만 보이고 뒤로 가기가 패치노트를 닫지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  await AsyncStorage.setItem(letterSeenKey('u1'), '1');
  const at = '2026-10-30T00:00:00Z';
  list.mockResolvedValue({
    items: [
      {
        publicationId: 'n1',
        title: '패치 소식',
        body: 'b',
        startsAt: at,
        endsAt: null,
        publishedAt: at,
      },
    ],
  });
  get.mockResolvedValue({ ...requirement, minVersion: null });
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: any) => {
    listeners.push(l);
    return { remove: jest.fn() };
  }) as never);
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.reset('sea'));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter-envelope')));
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  await waitFor(() => assert.ok(screen.queryByText('패치 소식')));
  get.mockResolvedValue(requirement);
  await act(async () => {
    listeners.forEach((l) => l('background'));
    listeners.forEach((l) => l('active'));
  });
  await waitFor(() => assert.equal(screen.queryByText('패치 소식'), null));
  assert.ok(screen.queryByTestId('developer-letter-envelope'));
  const back = backHandlers[backHandlers.length - 1];
  await act(async () => assert.equal(back(), true));
  assert.ok(screen.queryByTestId('developer-letter'));
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  await waitFor(() => assert.ok(screen.queryByText(requirement.title)));
  assert.equal(await AsyncStorage.getItem(letterSeenKey('u1')), '1');
});
