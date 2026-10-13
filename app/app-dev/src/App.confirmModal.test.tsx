/**
 * GROMO-2259 — e.confirm 의 선택 인자 cancel·onCancel.
 * 뗏목을 떠나려 할 때 「가입하지 않고 떠날까요?」 확인창이 취소 자리에 가입 버튼을 둔다.
 * 취소 버튼을 눌렀을 때만 onCancel 이 불리고, 바깥을 누르거나 뒤로가기(onRequestClose)로 닫을 때는 불리지 않는다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

beforeEach(async () => {
  captured = undefined;
  await clearSession();
});

// 확인창은 RN Modal 하나 — 뒤로가기(onRequestClose)와 바깥 누르기(자식 Pressable)를 직접 부른다
const modalOf = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.container.queryAll((instance) => instance.type === 'Modal')[0];

const open = async (opts?: object) => {
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  const action = jest.fn();
  const onCancel = jest.fn();
  await act(async () =>
    captured.confirm('가입하지 않고 떠날까요?', '본문', action, { onCancel, ...opts }),
  );
  return { screen, action, onCancel };
};

test('cancel 글자와 onCancel 을 주면 취소 버튼이 그 글자로 뜨고 누르면 닫은 뒤 onCancel 만 부른다', async () => {
  const { screen, action, onCancel } = await open({ ok: '떠나기', cancel: '이 섬에 가입' });
  assert.equal(screen.queryByText('취소'), null);
  await fireEvent.press(screen.getByText('이 섬에 가입'));
  assert.equal(onCancel.mock.calls.length, 1);
  assert.equal(action.mock.calls.length, 0);
  assert.equal(screen.queryByText('가입하지 않고 떠날까요?'), null);
});

test('cancel 을 안 주면 기본 「취소」 이고 확인 버튼은 action 만 부른다', async () => {
  const { screen, action, onCancel } = await open({ ok: '떠나기' });
  await fireEvent.press(screen.getByText('취소'));
  assert.equal(onCancel.mock.calls.length, 1);
  assert.equal(action.mock.calls.length, 0);

  await act(async () => captured.confirm('다시', '본문', action, { ok: '떠나기', onCancel }));
  await fireEvent.press(screen.getByText('떠나기'));
  assert.equal(action.mock.calls.length, 1);
  assert.equal(onCancel.mock.calls.length, 1);
});

test('onCancel 없이 cancel 글자만 줘도 닫기만 한다(다른 호출자 동작 불변)', async () => {
  const { screen, action } = await open({ onCancel: undefined, cancel: '아니요' });
  await fireEvent.press(screen.getByText('아니요'));
  assert.equal(action.mock.calls.length, 0);
  assert.equal(screen.queryByText('가입하지 않고 떠날까요?'), null);
});

test('뒤로가기(onRequestClose)와 바깥 누르기는 그냥 닫을 뿐 onCancel 을 부르지 않는다', async () => {
  const { screen, action, onCancel } = await open({ cancel: '이 섬에 가입' });
  await act(async () => modalOf(screen).props.onRequestClose());
  assert.equal(screen.queryByText('가입하지 않고 떠날까요?'), null);

  await act(async () => captured.confirm('다시', '본문', action, { onCancel, cancel: '가입' }));
  await act(async () => modalOf(screen).props.children.props.onPress());
  assert.equal(screen.queryByText('다시'), null);
  assert.equal(onCancel.mock.calls.length, 0);
  assert.equal(action.mock.calls.length, 0);
});
