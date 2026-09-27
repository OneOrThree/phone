import React from 'react';
import assert from 'node:assert/strict';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { GoldenFishCutscene, goldenFishVideoVariant } from '@/screens/focus/GoldenFishCutscene';
import { componentTokens } from '@/design-system/tokens';

const mockListeners: Record<string, (...args: any[]) => void> = {};
const mockPlay = jest.fn();
let mockPlayer: { loop: boolean; muted: boolean; play: typeof mockPlay };

jest.mock('expo', () => ({
  useEventListener: (_player: unknown, event: string, listener: (...args: any[]) => void) => {
    mockListeners[event] = listener;
  },
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup: (player: any) => void) => {
    mockPlayer = { loop: true, muted: true, play: mockPlay };
    setup(mockPlayer);
    return mockPlayer;
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

test('웹 검수 모드는 버튼 없이 음소거 영상 전체를 자동 재생한다', async () => {
  const screen = await render(<GoldenFishCutscene onFinish={jest.fn()} autoplayMuted />);
  assert.equal(mockPlay.mock.calls.length, 1);
  assert.equal(mockPlayer.muted, true);
  assert.equal(screen.queryByTestId('golden-fish-play'), null);
  await act(async () => mockListeners.statusChange({ status: 'readyToPlay' }));
  assert.equal(mockPlay.mock.calls.length, 2);
  await act(async () => mockListeners.playingChange({ isPlaying: true }));
  await screen.unmount();
});

test('재생 오류나 종료 이벤트가 없어도 컷신을 닫고 종료 콜백은 한 번만 보낸다', async () => {
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
  await act(async () => jest.advanceTimersByTime(4999));
  assert.equal(onTimeoutFinish.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  assert.equal(onTimeoutFinish.mock.calls.length, 1);
  await timeoutScreen.unmount();
  jest.useRealTimers();
});
