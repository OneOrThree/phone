import assert from 'node:assert/strict';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { cutsceneVideoBox, VideoCutscene } from '@/components/VideoCutscene';

test('영상 상자는 화면 높이에 맞춘 9:16 — 세로 폰은 좌우가 밖으로, 납작한 화면은 좌우 여백', () => {
  const phone = cutsceneVideoBox(440, 956); // iPhone 16 Pro Max
  assert.equal(Math.round(phone.width), 538);
  assert.ok(phone.left < 0 && phone.left > -50, `좌우 한쪽 ${phone.left}`);

  const tablet = cutsceneVideoBox(1024, 1366); // iPad 세로
  assert.equal(Math.round(tablet.width), 768);
  assert.ok(tablet.left > 0, '좌우 여백');

  const exact = cutsceneVideoBox(360, 640); // 정확히 9:16
  assert.equal(exact.width, 360);
  assert.equal(exact.left, 0);
});

test('첫 그림은 창 크기, 그 뒤에는 overlay 실측 크기로 상자를 다시 잡는다(회전·폰 프레임)', async () => {
  await render(<VideoCutscene source={1} accessibilityLabel="컷신" onFinish={() => {}} />);
  const video = () => StyleSheet.flatten(screen.getByTestId('video-cutscene-video').props.style);
  // jest 기본 창 750×1334
  assert.equal(video().width, cutsceneVideoBox(750, 1334).width);

  await act(async () =>
    fireEvent(screen.getByTestId('video-cutscene'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 874, height: 402 } },
    }),
  );
  assert.equal(video().width, cutsceneVideoBox(874, 402).width);
  assert.ok(video().left > 0, '가로 화면은 좌우 여백');
});
