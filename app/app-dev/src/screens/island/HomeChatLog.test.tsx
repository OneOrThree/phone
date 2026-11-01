import assert from 'node:assert/strict';
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';
import { HomeChatLog, type HomeChatLine } from '@/screens/island/HomeChatLog';

const LINE_MS = componentTokens.homeChatLog.lineMs;
const ENTRY_WINDOW_MS = componentTokens.homeChatLog.entryWindowMs;
let base = 0;
const line = (n: number, over: Partial<HomeChatLine> = {}): HomeChatLine => ({
  id: `m${n}`,
  name: `주민${n}`,
  text: `글${n}`,
  at: base + n,
  ...over,
});

let onAppState: (next: string) => void;
let subscription: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  base = Date.now();
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

test('홈에 들어오면 방금 올라온 글을 최대 3줄 「이름: 글」로 띄우고 말풍선 버튼을 둔다', async () => {
  const ui = await render(
    <HomeChatLog lines={[1, 2, 3, 4, 5].map((n) => line(n))} onOpen={() => {}} />,
  );
  expect(shownTexts(ui)).toEqual([3, 4, 5]);
  ui.getByText('주민5: 글5', hidden);
  ui.getByLabelText('섬 채팅 열기');
  await ui.unmount();
});

test('홈에 들어올 때 3초보다 오래된 이력은 띄우지 않고 3초 안의 글만 띄운다', async () => {
  const ui = await render(
    <HomeChatLog
      lines={[
        line(1, { at: base - 60_000 }),
        line(2, { at: base - ENTRY_WINDOW_MS - 1 }),
        line(3, { at: base - ENTRY_WINDOW_MS }),
        line(4),
      ]}
      onOpen={() => {}}
    />,
  );
  expect(shownTexts(ui)).toEqual([3, 4]);
  await ui.unmount();
});

test('이력만 있으면 줄 없이 말풍선만 남고, 다시 들어오면 그 시각 기준으로 3초를 다시 잰다', async () => {
  const old = [line(1, { at: base - 60_000 }), line(2, { at: base - 30_000 })];
  const first = await render(<HomeChatLog lines={old} onOpen={() => {}} />);
  expect(first.queryByTestId('home-chat-lines', hidden)).toBeNull();
  first.getByTestId('home-chat-open');
  await first.unmount();
  // 건물에 1분 있다가 나오면 그동안 올라온 글도 3초 밖이면 이력이다
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  const now = Date.now();
  const second = await render(
    <HomeChatLog
      lines={[...old, line(3, { at: now - ENTRY_WINDOW_MS - 1 }), line(4, { at: now - 1_000 })]}
      onOpen={() => {}}
    />,
  );
  expect(shownTexts(second)).toEqual([4]);
  await second.unmount();
});

test('빈 목록이 먼저 오고 이력이 이어 와도 띄우지 않는다', async () => {
  const ui = await render(<HomeChatLog lines={[]} onOpen={() => {}} />);
  await ui.rerender(<HomeChatLog lines={[line(1, { at: base - 60_000 })]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([]);
  await ui.unmount();
});

test('들어온 뒤 올라온 글은 폴링으로 늦게 받아도 띄운다', async () => {
  const old = line(1, { at: base - 60_000 });
  const ui = await render(<HomeChatLog lines={[old]} onOpen={() => {}} />);
  // 들어온 직후 올라온 글을 다음 10초 폴링에서 받는다
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  await ui.rerender(<HomeChatLog lines={[old, line(2, { at: base + 500 })]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([2]);
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

test('차단·권한 상실로 lines 에서 빠진 글은 띄워 둔 줄에서도 바로 제거한다', async () => {
  const ui = await render(<HomeChatLog lines={[line(1), line(2)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1, 2]);
  // 2번 글 작성자를 차단해 lines 에서 빠지면 줄에서도 사라진다(8초 전)
  await ui.rerender(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1]);
  await ui.unmount();
});

test('남은 글이 모두 빠져 lines 가 비면 띄운 줄도 바로 지운다', async () => {
  const ui = await render(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1]);
  // 하나뿐인 글의 작성자를 차단하면 빈 목록이 온다 — 8초를 기다리지 않는다
  await ui.rerender(<HomeChatLog lines={[]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([]);
  await ui.unmount();
});

test('다시 받는 중(pending)에 잠깐 빈 목록은 띄운 줄을 지우지 않는다', async () => {
  const ui = await render(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1]);
  await ui.rerender(<HomeChatLog lines={[]} pending onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1]);
  // 다시 받은 목록에 같은 글이 있으면 그대로 남는다
  await ui.rerender(<HomeChatLog lines={[line(1)]} onOpen={() => {}} />);
  expect(shownTexts(ui)).toEqual([1]);
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
