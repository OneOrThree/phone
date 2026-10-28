/**
 * GROMO-2169 — 편지 쓰기처럼 키보드가 떠 있는 화면에서 실패 알림(e.notify)이 사용자에게 보여야 한다.
 * 근거: src/App.tsx 의 전역 토스트가 KeyboardAvoidingView 밖에서 position:absolute·bottom:40 로
 * 고정돼 있었다 — 소프트 키보드는 화면 하단을 그 위에 덮어 그리므로, 키보드가 떠 있는 채로
 * 알림이 뜨면(예: BuildingInteriors.tsx 의 sendLetter 실패 → say → e.notify) 토스트가 키보드
 * 밑에 가려 사용자에게 보이지 않았다. 실제 렌더 트리를 보지 않는 로직 단위 테스트(notify가
 * 호출됐는가)만으로는 이 결함을 못 잡는다 — 여기서는 토스트 컨테이너의 style.bottom 이 키보드
 * 높이만큼 올라가는지(=키보드 위로 떠서 보이는지)를 검증한다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { Keyboard, Platform } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { clearSession } from '@/services/api/session';

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

// style 배열(RN 스타일 병합)에서 bottom 숫자 값을 찾는다
const bottomOf = (style: unknown): number | undefined => {
  const flat = ([] as any[]).concat(style as any);
  for (const s of flat) if (s && typeof s.bottom === 'number') return s.bottom;
  return undefined;
};

const originalOS = Platform.OS;

beforeEach(async () => {
  captured = undefined;
  await clearSession();
});

afterEach(() => {
  Platform.OS = originalOS;
});

test('키보드가 떠 있을 때 전역 알림 토스트는 키보드 높이만큼 위로 올라온다', async () => {
  const listeners: Record<string, (...args: any[]) => void> = {};
  const addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    callback: (...args: any[]) => void,
  ) => {
    listeners[event] = callback;
    return { remove: jest.fn() } as any;
  }) as any);

  try {
    const screen = await render(<App />);
    await waitFor(() => assert.ok(captured));

    // 편지 보내기 실패 시 BuildingInteriors.tsx 의 say()가 부르는 것과 같은 경로: e.notify(message)
    await act(async () => captured.notify('편지를 보내지 못했어요'));

    const toastBefore = screen.getByTestId('global-toast');
    assert.equal(
      bottomOf(toastBefore.props.style),
      40,
      '키보드가 없을 때는 기본 bottom(40)이어야 한다',
    );

    // 편지 쓰기 화면에서 TextInput 포커스로 소프트 키보드가 뜬 상황을 흉내 낸다
    await act(async () => listeners.keyboardDidShow?.({ endCoordinates: { height: 300 } }));

    const toastAfter = screen.getByTestId('global-toast');
    assert.equal(
      bottomOf(toastAfter.props.style),
      340,
      '키보드 높이(300)만큼 토스트가 위로 올라가 키보드에 가리지 않아야 한다',
    );

    // 키보드가 내려가면 원래 위치로 돌아온다
    await act(async () => listeners.keyboardDidHide?.());
    const toastHidden = screen.getByTestId('global-toast');
    assert.equal(bottomOf(toastHidden.props.style), 40);
  } finally {
    addListener.mockRestore();
  }
});

test('Android 는 windowSoftInputMode=adjustResize 로 영역이 이미 줄어들어 있어 키보드 높이를 또 더하지 않는다', async () => {
  Platform.OS = 'android';
  const listeners: Record<string, (...args: any[]) => void> = {};
  const addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    callback: (...args: any[]) => void,
  ) => {
    listeners[event] = callback;
    return { remove: jest.fn() } as any;
  }) as any);

  try {
    const screen = await render(<App />);
    await waitFor(() => assert.ok(captured));

    await act(async () => captured.notify('편지를 보내지 못했어요'));

    // 편지 쓰기 화면에서 TextInput 포커스로 소프트 키보드가 뜬 상황을 흉내 낸다
    await act(async () => listeners.keyboardDidShow?.({ endCoordinates: { height: 300 } }));

    const toastAfter = screen.getByTestId('global-toast');
    assert.equal(
      bottomOf(toastAfter.props.style),
      40,
      'Android 에서는 adjustResize 가 이미 키보드만큼 영역을 줄여주므로 bottom 을 추가로 올리면 이중 보정이 된다',
    );
  } finally {
    addListener.mockRestore();
  }
});
