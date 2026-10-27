import assert from 'node:assert/strict';
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';
import { HomeChatLog, type HomeChatLine } from '@/screens/island/HomeChatLog';

const LINE_MS = componentTokens.homeChatLog.lineMs;
const line = (n: number, over: Partial<HomeChatLine> = {}): HomeChatLine => ({
  id: `m${n}`,
  name: `주민${n}`,
  text: `글${n}`,
  at: 1_000 + n,
  ...over,
});

let onAppState: (next: string) => void;
let subscription: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    onAppState = handler as (next: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  subscription.mockRestore();
  jest.useRealTimers();
});

// 줄은 스크린리더에서 숨긴 채 그린다 — 숨긴 요소도 찾는다
const hidden = { includeHiddenElements: true };
const shownTexts = (ui: Awaited<ReturnType<typeof render>>) =>
  [1, 2, 3, 4, 5, 6].filter((n) => ui.queryByText(new RegExp(`글${n}$`), hidden) !== null);

test('홈에 들어오면 최근 글을 최대 3줄 「이름: 글」로 띄우고 말풍선 버튼을 둔다', async () => {
  const ui = await render(
    <HomeChatLog lines={[1, 2, 3, 4, 5].map((n) => line(n))} onOpen={() => {}} />,
  );
  expect(shownTexts(ui)).toEqual([3, 4, 5]);
  ui.getByText('주민5: 글5', hidden);
  ui.getByLabelText('섬 채팅 열기');
  await ui.unmount();
});

test('줄은 8초 뒤 사라지고 말풍선 버튼만 남는다', async () => {
  const ui = await render(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS - 100);
  });
  expect(shownTexts(ui)).toEqual([1]);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
  expect(shownTexts(ui)).toEqual([]);
  expect(ui.queryByTestId('home-chat-lines', hidden)).toBeNull();
  ui.getByTestId('home-chat-open');
  await ui.unmount();
});

test('새로 도착한 글은 한 줄씩 더하고, 오래된 글이 뒤늦게 보여도 띄우지 않는다', async () => {
  const ui = await render(<HomeChatLog lines={[line(2)]} onOpen={() => {}} />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS + 100);
  });
  // 차단 해제 등으로 예전 글(1)이 다시 보이고, 새 글(3)이 도착했다
  await ui.rerender(<HomeChatLog lines={[line(1), line(2), line(3)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([3]);
  await ui.unmount();
});

test('앱이 백그라운드인 동안은 8초가 흐르지 않는다', async () => {
  const ui = await render(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS / 2);
    onAppState('background');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS * 3);
  });
  expect(shownTexts(ui)).toEqual([1]);
  await act(async () => {
    onAppState('active');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS / 2 - 200);
  });
  expect(shownTexts(ui)).toEqual([1]);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  expect(shownTexts(ui)).toEqual([]);
  await ui.unmount();
});

test('동작 줄이기에서도 8초 뒤 사라진다', async () => {
  const ui = await render(
    <MotionContext.Provider value>
      <HomeChatLog lines={[line(1)]} onOpen={() => {}} />
    </MotionContext.Provider>,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(LINE_MS + 100);
  });
  expect(shownTexts(ui)).toEqual([]);
  await ui.unmount();
});

test('줄이나 말풍선을 누르면 채팅방을 연다 — 스크린리더는 말풍선 하나만 읽는다', async () => {
  const onOpen = jest.fn();
  const ui = await render(<HomeChatLog lines={[line(1)]} onOpen={onOpen} />);
  await fireEvent.press(ui.getByTestId('home-chat-lines', hidden));
  await fireEvent.press(ui.getByTestId('home-chat-open'));
  assert.equal(onOpen.mock.calls.length, 2);
  assert.equal(
    ui.getByTestId('home-chat-lines', hidden).props.importantForAccessibility,
    'no-hide-descendants',
  );
  await ui.unmount();
});
