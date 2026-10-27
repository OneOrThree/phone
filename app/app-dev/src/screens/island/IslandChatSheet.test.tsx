import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { initialState } from '@/services/model';
import { IslandChatSheet } from '@/screens/island/IslandChatSheet';
import type { IslandChat } from '@/screens/island/useIslandChat';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));

const NOW = Date.parse('2026-09-20T12:00:00Z');

const message = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  clientMessageId: id,
  userId: 'u2',
  name: '민지',
  text: `글 ${id}`,
  createdAt: '2026-09-20T11:55:00Z',
  ...over,
});

const chatOf = (over: Partial<IslandChat> = {}): IslandChat => ({
  messages: [],
  messagesCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  myId: 'u1',
  retry: jest.fn(async () => {}),
  loadMoreMessages: jest.fn(async () => {}),
  sendMessage: jest.fn(async () => message('sent')),
  ...over,
});

// e.text·e.setText 는 앱이 들고 있는 입력 초안이다 — 테스트에서도 상태로 들고 다시 그린다
function Harness({ e: base, chat }: { e: any; chat: IslandChat }) {
  const [text, setText] = useState<string>(base.text ?? '');
  return <IslandChatSheet e={{ ...base, text, setText }} chat={chat} />;
}

const env = (over: Record<string, unknown> = {}) => ({
  islands: {},
  state: initialState(true),
  now: NOW,
  back: jest.fn(),
  notify: jest.fn(),
  dispatch: jest.fn(),
  setFailNext: jest.fn(),
  failNext: false,
  ...over,
});

test('서버 채팅 — 남의 글은 이름·시각과 함께, 내 글은 「나 · 시각」으로 그린다', async () => {
  const chat = chatOf({
    messages: [message('m1'), message('m2', { userId: 'u1', name: '나나', text: '내 글' })],
  });
  const ui = await render(<Harness e={env()} chat={chat} />);
  ui.getByText('우리 섬 채팅방');
  ui.getByText('민지');
  ui.getByText('글 m1');
  ui.getByText('내 글');
  ui.getByText('나 · 5분 전');
  expect(ui.queryByText('나나')).toBeNull();
  await ui.unmount();
});

test('보내기 — 성공하면 입력을 비우고, 실패하면 초안을 두고 서버 문구를 알린다', async () => {
  const sendMessage = jest
    .fn()
    .mockRejectedValueOnce(new ApiError('NETWORK', '연결이 끊겼어요', 0))
    .mockResolvedValueOnce(message('m9'));
  const e = env({ text: '같이 해요' });
  const ui = await render(<Harness e={e} chat={chatOf({ sendMessage })} />);

  await fireEvent.press(ui.getByTestId('island-message-send'));
  await waitFor(() => assert.equal(e.notify.mock.calls.at(-1)?.[0], '연결이 끊겼어요'));
  assert.equal(ui.getByTestId('island-message-input').props.value, '같이 해요');

  await fireEvent.press(ui.getByTestId('island-message-send'));
  await waitFor(() => assert.equal(ui.getByTestId('island-message-input').props.value, ''));
  expect(sendMessage.mock.calls).toEqual([['같이 해요'], ['같이 해요']]);
  await ui.unmount();
});

test('시트를 닫은 뒤 늦은 전송 성공은 공용 입력 초안을 지우지 않는다', async () => {
  let resolveSend: (v: unknown) => void = () => {};
  const sendMessage = jest.fn(() => new Promise((r) => (resolveSend = r)));
  const setText = jest.fn();
  // Harness 대신 직접 그린다 — 공용 setText(편지 쓰기와 공유) 가 늦은 응답에 불리는지 본다
  const ui = await render(
    <IslandChatSheet
      e={{ ...env({ text: '같이 해요' }), text: '같이 해요', setText }}
      chat={chatOf({ sendMessage: sendMessage as any })}
    />,
  );
  await fireEvent.press(ui.getByTestId('island-message-send'));
  await ui.unmount(); // 시트를 닫는다(편지 쓰기 등으로 이동)
  await act(async () => {
    resolveSend(message('m9'));
    await Promise.resolve();
  });
  assert.equal(setText.mock.calls.length, 0); // 늦은 성공이 setText 를 호출하지 않는다
});

test('빈 글은 보내지 않고 안내한다', async () => {
  const chat = chatOf();
  const e = env({ text: '   ' });
  const ui = await render(<Harness e={e} chat={chat} />);
  await fireEvent.press(ui.getByTestId('island-message-send'));
  assert.equal((chat.sendMessage as jest.Mock).mock.calls.length, 0);
  assert.equal(e.notify.mock.calls[0][0], '남길 말을 적어 주세요');
  await ui.unmount();
});

test('불러오는 중 · 빈 목록 · 실패를 구분하고 실패는 다시 시도할 수 있다', async () => {
  const loading = await render(<Harness e={env()} chat={chatOf({ loading: true })} />);
  loading.getByText('글을 불러오는 중이에요…');
  await loading.unmount();

  const empty = await render(<Harness e={env()} chat={chatOf()} />);
  empty.getByText('아직 남긴 글이 없어요.');
  await empty.unmount();

  const chat = chatOf({ error: new ApiError('NETWORK', '연결 오류', 0) });
  const failed = await render(<Harness e={env()} chat={chat} />);
  failed.getByText('연결 오류');
  await fireEvent.press(failed.getByTestId('chat-retry'));
  assert.equal((chat.retry as jest.Mock).mock.calls.length, 1);
  await failed.unmount();
});

test('글이 있는 채로 갱신이 실패하면 글을 두고 다시 시도를 붙인다', async () => {
  const chat = chatOf({
    messages: [message('m1')],
    error: new ApiError('NETWORK', '연결 오류', 0),
  });
  const ui = await render(<Harness e={env()} chat={chat} />);
  ui.getByText('글 m1');
  await fireEvent.press(ui.getByTestId('chat-refresh-retry'));
  assert.equal((chat.retry as jest.Mock).mock.calls.length, 1);
  await ui.unmount();
});

test('더 오래된 글이 있으면 「이전 글 더 보기」로 이어 읽는다', async () => {
  const chat = chatOf({ messages: [message('m1')], messagesCursor: 'old' });
  const ui = await render(<Harness e={env()} chat={chat} />);
  await fireEvent.press(ui.getByTestId('chat-more'));
  assert.equal((chat.loadMoreMessages as jest.Mock).mock.calls.length, 1);
  await ui.unmount();
});

test('보이는 글이 없어도 커서가 있으면 「이전 글 더 보기」를 두고 빈 안내는 숨긴다(차단 필터 회귀 방지)', async () => {
  const chat = chatOf({ messages: [], messagesCursor: 'old' });
  const ui = await render(<Harness e={env()} chat={chat} />);
  ui.getByTestId('chat-more');
  expect(ui.queryByText('아직 남긴 글이 없어요.')).toBeNull();
  await ui.unmount();
});

test('닫기 × 는 이전 화면으로 돌아간다', async () => {
  const e = env();
  const ui = await render(<Harness e={e} chat={chatOf()} />);
  await fireEvent.press(ui.getByLabelText('닫기'));
  assert.equal(e.back.mock.calls.length, 1);
  await ui.unmount();
});

test('목업 섬 — 로컬 글을 그리고 보내기·다시 보내기는 리듀서 액션으로 간다', async () => {
  const state = initialState(true);
  const island = state.islands.find((i) => i.id === state.islandId)!;
  island.messages = [
    {
      id: 'f1',
      memberId: 'me',
      name: '나',
      color: 'gray',
      text: '못 간 글',
      at: NOW,
      status: 'failed',
    },
    {
      id: 'o1',
      memberId: 'm2',
      name: '보리',
      color: 'ginger',
      text: '안녕',
      at: NOW,
      status: 'sent',
    },
  ];
  const e = env({ islands: undefined, state, text: '목업 글' });
  const ui = await render(<Harness e={e} chat={chatOf()} />);
  ui.getByText('보리');
  ui.getByText('못 간 글');
  await act(async () => {});
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'CHAT_READ' });

  await fireEvent.press(ui.getByTestId('chat-retry-f1'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'RETRY_MESSAGE', id: 'f1' });
  await fireEvent.press(ui.getByTestId('island-message-send'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'MESSAGE', text: '목업 글', fail: false });
  await waitFor(() => assert.equal(ui.getByTestId('island-message-input').props.value, ''));
  await ui.unmount();
});
