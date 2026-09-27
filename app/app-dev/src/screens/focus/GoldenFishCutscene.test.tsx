import React from 'react';
import assert from 'node:assert/strict';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { GoldenFishCutscene, goldenFishVideoVariant } from '@/screens/focus/GoldenFishCutscene';
import { componentTokens } from '@/design-system/tokens';

const mockListeners: Record<string, (...args: any[]) => void> = {};
const mockPlay = jest.fn();
let mockPlayer: {
  loop: boolean;
  muted: boolean;
  volume: number;
  timeUpdateEventInterval: number;
  play: typeof mockPlay;
};

jest.mock('expo', () => ({
  useEventListener: (_player: unknown, event: string, listener: (...args: any[]) => void) => {
    mockListeners[event] = listener;
  },
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    const ReactModule = require('react');
    const playerRef = ReactModule.useRef(null);
    if (!playerRef.current) {
      playerRef.current = {
        loop: true,
        muted: true,
        volume: 1,
        timeUpdateEventInterval: 0,
        play: mockPlay,
      };
      setup(playerRef.current);
    }
    mockPlayer = playerRef.current;
    return playerRef.current;
  },
  VideoView: 'VideoView',
}));

beforeEach(() => {
  jest.clearAllMocks();
  for (const event of Object.keys(mockListeners)) delete mockListeners[event];
});

test('화면 방향과 최소 너비로 세로·가로 황금 물고기 영상을 고른다', () => {
  assert.equal(goldenFishVideoVariant(390, 844), 'portrait');
  assert.equal(goldenFishVideoVariant(844, 390), 'landscape');
  assert.equal(goldenFishVideoVariant(540, 360), 'portrait');
  assert.equal(goldenFishVideoVariant(2048, 1400), 'landscape');
  assert.equal(goldenFishVideoVariant(1024, 1366), 'portrait');
});

test('서버 신호로 마운트되면 바다 소리를 포함해 1회 재생하고 종료 콜백을 한 번만 보낸다', async () => {
  const onFinish = jest.fn();
  const screen = await render(<GoldenFishCutscene onFinish={onFinish} />);
  assert.equal(
    screen.getByTestId('golden-fish-cutscene').props.accessibilityLiveRegion,
    'assertive',
  );
  assert.equal(screen.getByTestId('golden-fish-cutscene').props.pointerEvents, 'auto');
  assert.equal(screen.getByTestId('golden-fish-cutscene').props.accessibilityViewIsModal, true);
  assert.equal(mockPlayer.loop, false);
  assert.equal(mockPlayer.muted, false);
  assert.equal(mockPlayer.volume, 1);
  assert.equal(mockPlayer.timeUpdateEventInterval, 0.5);
  assert.equal(mockPlay.mock.calls.length, 1);
  const videoStyle = StyleSheet.flatten(screen.getByTestId('golden-fish-video').props.style);
  assert.equal(videoStyle.width, '100%');
  assert.equal(videoStyle.height, '100%');
  assert.equal(screen.getByTestId('golden-fish-video').props.contentFit, 'contain');
  const overlayStyle = StyleSheet.flatten(screen.getByTestId('golden-fish-cutscene').props.style);
  assert.equal(overlayStyle.backgroundColor, componentTokens.overlay.cinematicBackground);
  await act(async () => {
    mockListeners.playToEnd();
    mockListeners.playToEnd();
  });
  assert.equal(onFinish.mock.calls.length, 1);
  await screen.unmount();
});

test('소리 설정을 반영하고 버튼 없이 음소거 영상 전체를 자동 재생한다', async () => {
  const screen = await render(<GoldenFishCutscene onFinish={jest.fn()} muted volume={0.35} />);
  assert.equal(mockPlay.mock.calls.length, 1);
  assert.equal(mockPlayer.muted, true);
  assert.equal(mockPlayer.volume, 0.35);
  assert.equal(screen.queryByTestId('golden-fish-play'), null);
  await act(async () => mockListeners.statusChange({ status: 'readyToPlay' }));
  assert.equal(mockPlay.mock.calls.length, 2);
  await act(async () => mockListeners.playingChange({ isPlaying: true }));
  await screen.unmount();
});

test('재생 오류나 시작 실패는 닫되 재생 중에는 실제 종료 이벤트까지 기다린다', async () => {
  jest.useFakeTimers();
  const onErrorFinish = jest.fn();
  const errorScreen = await render(<GoldenFishCutscene onFinish={onErrorFinish} />);
  await act(async () => {
    mockListeners.statusChange({ status: 'error' });
    mockListeners.playToEnd();
  });
  assert.equal(onErrorFinish.mock.calls.length, 1);
  await errorScreen.unmount();

  const onTimeoutFinish = jest.fn();
  const timeoutScreen = await render(<GoldenFishCutscene onFinish={onTimeoutFinish} />);
  await act(async () => mockListeners.playingChange({ isPlaying: true }));
  await act(async () => jest.advanceTimersByTime(8000));
  assert.equal(onTimeoutFinish.mock.calls.length, 0);
  await act(async () => mockListeners.playToEnd());
  assert.equal(onTimeoutFinish.mock.calls.length, 1);
  await timeoutScreen.unmount();

  const onNeverStartedFinish = jest.fn();
  const neverStartedScreen = await render(<GoldenFishCutscene onFinish={onNeverStartedFinish} />);
  await act(async () => jest.advanceTimersByTime(7999));
  assert.equal(onNeverStartedFinish.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  assert.equal(onNeverStartedFinish.mock.calls.length, 1);
  await neverStartedScreen.unmount();
  jest.useRealTimers();
});

test('부모가 재렌더되어도 시작 실패 복구 타이머를 다시 시작하지 않는다', async () => {
  jest.useFakeTimers();
  const callbacks = Array.from({ length: 8 }, () => jest.fn());
  const screen = await render(<GoldenFishCutscene onFinish={callbacks[0]} />);

  for (let index = 1; index < callbacks.length; index++) {
    await act(async () => jest.advanceTimersByTime(1_000));
    await screen.rerender(<GoldenFishCutscene onFinish={callbacks[index]} />);
  }
  await act(async () => jest.advanceTimersByTime(1_000));

  assert.equal(
    callbacks.slice(0, -1).some((callback) => callback.mock.calls.length > 0),
    false,
  );
  assert.equal(callbacks.at(-1)?.mock.calls.length, 1);
  await screen.unmount();
  jest.useRealTimers();
});

test('포그라운드에서 재생 진행이 멈추면 한 번 재시도한 뒤 화면 잠금을 해제한다', async () => {
  jest.useFakeTimers();
  const onFinish = jest.fn();
  const screen = await render(<GoldenFishCutscene onFinish={onFinish} />);
  await act(async () => mockListeners.playingChange({ isPlaying: true }));

  await act(async () => jest.advanceTimersByTime(12_000));
  assert.equal(mockPlay.mock.calls.length, 2);
  assert.equal(onFinish.mock.calls.length, 0);

  await act(async () => mockListeners.timeUpdate({ currentTime: 1 }));
  await act(async () => jest.advanceTimersByTime(12_000));
  assert.equal(mockPlay.mock.calls.length, 3);
  assert.equal(onFinish.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(12_000));
  assert.equal(onFinish.mock.calls.length, 1);

  await screen.unmount();
  jest.useRealTimers();
});
