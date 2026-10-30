/**
 * GROMO-2615 — 실제 App 경로의 운영진의 편지. listDeveloperNotices 만 모의하고
 * useDeveloperLetter·isLetterReady·DeveloperLetter·orientation 훅은 실제로 돌린다(CurrentScreens 는 e 포착용).
 */
import assert from 'node:assert/strict';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, BackHandler } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import * as notices from '@/services/api/developerNotices';
import { letterSeenKey } from '@/services/developerLetter';
import { clearSession, saveSession } from '@/services/api/session';

let captured: any;
let mockTablet = false;

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/api/developerNotices', () => ({ listDeveloperNotices: jest.fn() }));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => undefined),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', DEFAULT: 'DEFAULT' },
}));
jest.mock('@/utils/layout', () => {
  const actual = jest.requireActual('@/utils/layout');
  return {
    ...actual,
    useAppLayout: () => ({
      ...actual.useAppLayout(),
      // jest 기본 창(750×1334)은 태블릿으로 판정되므로 폰 크기를 명시한다
      ...(mockTablet
        ? { tablet: true, width: 820, height: 1180 }
        : { tablet: false, width: 390, height: 844 }),
    }),
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

const list = notices.listDeveloperNotices as jest.Mock;
const lock = ScreenOrientation.lockAsync as jest.Mock;
const AT = '2026-10-30T00:00:00Z';
const notice = {
  publicationId: 'p1',
  title: '패치 소식',
  body: '평문 본문',
  startsAt: AT,
  endsAt: null,
  publishedAt: AT,
};
const backHandlers: (() => boolean)[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  captured = undefined;
  mockTablet = false;
  backHandlers.length = 0;
  // jest 의 AppState 는 'active' 가 아니라 appActive 가 거짓이다
  (AppState as any).currentState = 'active';
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, h: () => boolean) => {
    backHandlers.push(h);
    return { remove: jest.fn() };
  }) as never);
  await AsyncStorage.clear();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  await AsyncStorage.setItem(letterSeenKey('u1'), '1');
});

// 서버 세션이 있는 상태로 바다에 선 App
const boot = async () => {
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.reset('sea'));
  return screen;
};

test('조건이 맞고 공지가 있으면 오버레이가 뜨고 뒤 화면은 스크린 리더에서 숨는다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  assert.equal(captured.letterOpen, true);
  assert.equal(
    screen.getByTestId('app-content', { includeHiddenElements: true }).props
      .accessibilityElementsHidden,
    true,
  );
  assert.equal(
    screen.getByTestId('app-content', { includeHiddenElements: true }).props
      .importantForAccessibility,
    'no-hide-descendants',
  );
});

test('공지가 없으면 오버레이가 없다', async () => {
  list.mockResolvedValue({ items: [] });
  const screen = await boot();
  await waitFor(() => assert.ok(list.mock.calls.length > 0));
  assert.equal(screen.queryByTestId('developer-letter'), null);
  assert.equal(captured.letterOpen, false);
  assert.equal(
    screen.getByTestId('app-content', { includeHiddenElements: true }).props
      .accessibilityElementsHidden,
    false,
  );
});

test('폰은 편지가 뜨면 세로로 잠그고 닫으면 경로 정책으로 돌아간다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await waitFor(() => expect(lock).toHaveBeenLastCalledWith('PORTRAIT_UP'));
  await act(async () => backHandlers[backHandlers.length - 1]());
  await waitFor(() => expect(lock).toHaveBeenLastCalledWith('DEFAULT'));
});

test('태블릿은 편지가 떠도 잠그지 않는다(마지막 잠금이 바다 경로의 DEFAULT)', async () => {
  mockTablet = true;
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await act(async () => {});
  expect(lock).toHaveBeenLastCalledWith('DEFAULT');
});

test('hardwareBackPress 는 편지를 닫고 visibleAt 을 저장한다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  let handled = false;
  await act(async () => {
    handled = backHandlers[backHandlers.length - 1]();
  });
  assert.equal(handled, true);
  assert.equal(screen.queryByTestId('developer-letter'), null);
  await waitFor(async () =>
    assert.equal(await AsyncStorage.getItem(letterSeenKey('u1')), String(Date.parse(AT))),
  );
  assert.equal(captured.letterOpen, false);
});

test('바깥(배경) 누르기로는 닫히지 않는다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await fireEvent.press(screen.getByTestId('developer-letter'));
  assert.ok(screen.queryByTestId('developer-letter'));
});

test('화면 안쪽 안내(sceneGuide)가 떠 있으면 조회도 표시도 없고, 끝나면 뜬다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setSceneGuideOpen(true));
  await act(async () => captured.reset('sea'));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  assert.equal(screen.queryByTestId('developer-letter'), null);
  expect(list).not.toHaveBeenCalled();
  await act(async () => captured.setSceneGuideOpen(false));
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
});

test('이미 뜬 편지는 안내 신호가 켜져도 내려가지 않는다', async () => {
  list.mockResolvedValue({ items: [notice] });
  const screen = await boot();
  await waitFor(() => assert.ok(screen.queryByTestId('developer-letter')));
  await act(async () => captured.setSceneGuideOpen(true));
  assert.ok(screen.queryByTestId('developer-letter'));
});
