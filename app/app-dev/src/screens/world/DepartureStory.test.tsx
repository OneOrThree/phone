import React from 'react';
import { Animated, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import { DepartureStory } from './DepartureStory';
import { componentTokens } from '@/design-system/tokens';
import { cat } from '@/constants/assets';
import { applyLocalePref } from '@/i18n';
import { initialState, type Color } from '@/services/model';

let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('@/utils/layout', () => ({ useAppLayout: () => ({ width: 402, height: 874 }) }));
// 장식 이미지도 조회해 로딩 완료와 털색 합성을 검증한다.
configure({ defaultIncludeHiddenElements: true });
const listeners = new Set<(state: AppStateStatus) => void>();

beforeEach(() => {
  jest.useFakeTimers();
  mockGeneration = 0;
  listeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  // 네이티브 드라이버의 완료만 시계로 재현하며, 중지한 애니메이션은 완료시키지 않는다.
  jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => {
    let timer: ReturnType<typeof setTimeout>;
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        timer = setTimeout(() => callback?.({ finished: true }), config.duration ?? 0);
      },
      stop: () => clearTimeout(timer),
      reset: jest.fn(),
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  applyLocalePref('ko');
});

async function load(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent(screen.getByTestId('departure-background-0'), 'load');
  for (let index = 0; index < 3; index++)
    await fireEvent(screen.getByTestId(`departure-cat-${index}`), 'load');
}

async function changeAppState(value: AppStateStatus) {
  await act(async () => listeners.forEach((listener) => listener(value)));
}

test('그림 로딩 후에 세 컷을 재생하고 완료·오류가 겹쳐도 한 번만 이동한다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await act(async () => jest.advanceTimersByTime(10_000));
  expect(done).not.toHaveBeenCalled();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  await load(screen);
  await act(async () => jest.advanceTimersByTime(4199));
  expect(done).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  await fireEvent(screen.getByTestId('departure-cat-0'), 'error');
  expect(done).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test('비활성·백그라운드 시간을 제외하고 남은 재생 시간을 이어 간다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="집중섬" onComplete={done} />,
  );
  await load(screen);
  await act(async () => jest.advanceTimersByTime(1000));
  await changeAppState('inactive');
  await changeAppState('background');
  await act(async () => jest.advanceTimersByTime(30_000));
  expect(done).not.toHaveBeenCalled();
  await changeAppState('active');
  await act(async () => jest.advanceTimersByTime(3199));
  expect(done).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(done).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test('화면 회전은 장면 전체를 맞추며 진행 시간을 처음부터 돌리지 않는다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await load(screen);
  await act(async () => jest.advanceTimersByTime(2000));
  await fireEvent(screen.getByTestId('departure-story'), 'layout', {
    nativeEvent: { layout: { width: 844, height: 390 } },
  });
  const scene = StyleSheet.flatten(screen.getByTestId('departure-scene').props.style);
  expect(scene.width).toBeLessThanOrEqual(844);
  expect(scene.height).toBe(390);
  await act(async () => jest.advanceTimersByTime(2200));
  expect(done).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test.each(['black', 'gray', 'calico', 'ginger', 'white', 'cream'] as Color[])(
  '%s 고양이는 공통 배경 위에 해당 털색의 세 자세로 합성한다',
  async (color) => {
    const state = { ...initialState(true), color };
    const screen = await render(
      <DepartureStory state={state} destination="먼바다" onComplete={jest.fn()} />,
    );
    expect(screen.getByTestId('departure-cat-0').props.source).toBe(
      cat(color, 'tilt/tilt-frame-2'),
    );
    expect(screen.getByTestId('departure-cat-1').props.source).toBe(cat(color, 'idle'));
    expect(screen.getByTestId('departure-cat-2').props.source).toBe(cat(color, 'side'));
    expect(screen.getByTestId('departure-background-0').props.source).toBe(
      screen.getByTestId('departure-background-2').props.source,
    );
    await screen.unmount();
  },
);

test('동작 줄이기는 기울이지 않고 영어 목적지를 접근성 설명에 포함한다', async () => {
  applyLocalePref('en');
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const screen = await render(
    <DepartureStory state={state} destination="Open sea" onComplete={jest.fn()} />,
  );
  expect(screen.getByRole('image').props.accessibilityLabel).toContain(
    'Preparing to depart for Open sea',
  );
  const style = StyleSheet.flatten(screen.getByTestId('departure-cat-0').props.style);
  expect(style.transform).toContainEqual({ rotate: '0deg' });
  await screen.unmount();
});

test('이미지 실패 시 진입을 막지 않고 목적지로 한 번만 이어 준다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await fireEvent(screen.getByTestId('departure-background-0'), 'error');
  await fireEvent(screen.getByTestId('departure-cat-0'), 'error');
  expect(done).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test('다른 계정으로 바뀌거나 언마운트되면 이전 출항 완료가 화면을 이동시키지 않는다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await load(screen);
  mockGeneration++;
  await act(async () => jest.advanceTimersByTime(componentTokens.departureStory.durationMs));
  expect(done).not.toHaveBeenCalled();
  await screen.unmount();
  const again = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await load(again);
  await again.unmount();
  await act(async () => jest.advanceTimersByTime(componentTokens.departureStory.durationMs));
  expect(done).not.toHaveBeenCalled();
});

test('백그라운드에서 이미지가 실패해도 복귀하기 전에는 화면을 이동시키지 않는다', async () => {
  const done = jest.fn();
  const screen = await render(
    <DepartureStory state={initialState(true)} destination="먼바다" onComplete={done} />,
  );
  await changeAppState('background');
  await fireEvent(screen.getByTestId('departure-background-0'), 'error');
  expect(done).not.toHaveBeenCalled();
  await changeAppState('active');
  expect(done).toHaveBeenCalledTimes(1);
  await screen.unmount();
});
