import React from 'react';
import { Animated, AppState, type AppStateStatus, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { cat } from '@/constants/assets';
import { HarborCutscene } from './HarborCutscene';

type Completion = (result: { finished: boolean }) => void;
let runs: { duration: number; complete: Completion; stop: jest.Mock }[];
let changeState: (state: AppStateStatus) => void;
const props = {
  color: 'calico' as const,
  direction: 'departure' as const,
  accessibilityLabel: '출항',
};

beforeEach(() => {
  jest.useFakeTimers();
  runs = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    changeState = handler;
    return { remove: jest.fn() };
  });
  jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => {
    const stop = jest.fn();
    return {
      start: (complete: Completion) => runs.push({ duration: config.duration!, complete, stop }),
      stop,
      reset: jest.fn(),
    } as any;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const baseImages = [
  'harbor-ocean-1-1',
  'harbor-island',
  'harbor-raft-back',
  'harbor-raft-front',
  'harbor-cat',
];
async function loadImages(screen: Awaited<ReturnType<typeof render>>, ids = baseImages) {
  for (const id of ids) await fireEvent(screen.getByTestId(id), 'load');
}

test('웹 보관용 항해 중단 시안은 섬 없이 내 고양이가 쉬는 3초 장면이다', async () => {
  const done = jest.fn();
  const screen = await render(<HarborCutscene {...props} direction="abandon" onFinish={done} />);
  expect(screen.queryByTestId('harbor-island')).toBeNull();
  await loadImages(screen, [
    ...baseImages.filter((id) => id !== 'harbor-island'),
    'harbor-cat-rest',
  ]);
  expect(runs).toHaveLength(1);
  expect(runs[0].duration).toBe(3000);
  await act(async () => runs[0].complete({ finished: true }));
  expect(done).toHaveBeenCalledTimes(1);
});

test('펠리컨 배달은 필수 원화가 준비된 뒤 5초 재생하고 한 번만 완료한다', async () => {
  const done = jest.fn();
  const screen = await render(
    <HarborCutscene {...props} direction="pelican-mail" onFinish={done} />,
  );
  const ids = [
    ...baseImages.filter((id) => id !== 'harbor-island'),
    'delivery-bird-up',
    'delivery-bird-down',
    'delivery-bird-rest',
    'delivery-book',
    'delivery-book-depth',
  ];
  await loadImages(screen, ids.slice(0, -1));
  expect(runs).toHaveLength(0);
  await fireEvent(screen.getByTestId(ids.at(-1)!), 'load');
  expect(runs).toHaveLength(1);
  expect(runs[0].duration).toBe(5000);
  await act(async () => runs[0].complete({ finished: true }));
  await act(async () => runs[0].complete({ finished: true }));
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('harbor-island')).toBeNull();
});

test('내 털색으로 그리며 원화를 모두 읽은 뒤에만 출항한다', async () => {
  const done = jest.fn();
  const screen = await render(<HarborCutscene {...props} onFinish={done} />);
  expect(screen.getByTestId('harbor-cat').props.source).toEqual(cat('calico', 'idle'));
  expect(runs).toHaveLength(0);
  await loadImages(screen);
  expect(runs).toHaveLength(1);
  expect(runs[0].duration).toBe(4000);
  expect(done).not.toHaveBeenCalled();
});

test('비교 화면은 원화 준비를 알린 뒤 원본 영상이 준비될 때까지 재생을 기다릴 수 있다', async () => {
  const ready = jest.fn();
  const done = jest.fn();
  const screen = await render(<HarborCutscene {...props} paused onReady={ready} onFinish={done} />);
  await loadImages(screen);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(runs).toHaveLength(0);
  await act(async () => jest.advanceTimersByTime(12000));
  expect(done).not.toHaveBeenCalled();
  await screen.rerender(
    <HarborCutscene {...props} paused={false} onReady={ready} onFinish={done} />,
  );
  expect(runs).toHaveLength(1);
  expect(runs[0].duration).toBe(4000);
});

test('백그라운드에서 멈추고 남은 시간만 이어 재생하며 완료는 한 번이다', async () => {
  const done = jest.fn();
  const screen = await render(<HarborCutscene {...props} onFinish={done} />);
  await loadImages(screen);
  await act(async () => jest.advanceTimersByTime(1200));
  await act(async () => changeState('background'));
  expect(runs[0].stop).toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(20000));
  expect(done).not.toHaveBeenCalled();
  await act(async () => runs[0].complete({ finished: true })); // 중단된 실행의 늦은 콜백
  expect(done).not.toHaveBeenCalled();
  await act(async () => changeState('active'));
  expect(runs[1].duration).toBe(2800);
  await act(async () => runs[1].complete({ finished: true }));
  await act(async () => runs[1].complete({ finished: true }));
  expect(done).toHaveBeenCalledTimes(1);
});

test('회전해도 재생을 재시작하지 않고 바다를 새 화면 전체에 깐다', async () => {
  const screen = await render(<HarborCutscene {...props} onFinish={jest.fn()} />);
  await loadImages(screen);
  await fireEvent(screen.getByTestId('harbor-cutscene'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 1366, height: 1024 } },
  });
  expect(runs).toHaveLength(1);
  const ocean = StyleSheet.flatten(screen.getByTestId('harbor-ocean').props.style);
  expect(ocean.width).toBeGreaterThan(1366);
  expect(ocean.height).toBeGreaterThan(1024);
  expect(
    StyleSheet.flatten(screen.getByTestId('harbor-island').props.style).width,
  ).toBeLessThanOrEqual(620);
});

test('동작 줄이기와 원화 실패는 한 번만 완료하고, 로딩 중 비활성 시간은 기다림에 넣지 않는다', async () => {
  const reduced = jest.fn();
  const screen = await render(
    <MotionContext.Provider value>
      <HarborCutscene {...props} onFinish={reduced} />
    </MotionContext.Provider>,
  );
  expect(screen.queryByTestId('harbor-cutscene')).toBeNull();
  expect(reduced).toHaveBeenCalledTimes(1);
  const done = jest.fn();
  await screen.rerender(<HarborCutscene {...props} onFinish={done} />);
  await act(async () => changeState('inactive'));
  await act(async () => jest.advanceTimersByTime(15000));
  expect(done).not.toHaveBeenCalled();
  await act(async () => changeState('active'));
  await fireEvent(screen.getByTestId('harbor-island'), 'error');
  await act(async () => jest.advanceTimersByTime(8000));
  expect(done).toHaveBeenCalledTimes(1);
});

test('언마운트 뒤 도착 콜백을 실행하지 않는다', async () => {
  const done = jest.fn();
  const screen = await render(<HarborCutscene {...props} direction="arrival" onFinish={done} />);
  await loadImages(screen);
  await screen.unmount();
  await act(async () => runs[0].complete({ finished: true }));
  expect(done).not.toHaveBeenCalled();
});
