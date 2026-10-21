import React from 'react';
import { VideoCutscene } from '@/components/VideoCutscene';

const SOURCE = require('@/assets/ota/cutscenes/golden-fish.mp4');

export function GoldenFishCutscene({
  onFinish,
  muted,
  volume,
}: {
  onFinish: () => void;
  muted?: boolean;
  volume?: number;
}) {
  return (
    <VideoCutscene
      source={SOURCE}
      accessibilityLabel="여러 고양이가 힘을 모아 황금 물고기를 낚아 올렸어요"
      testID="golden-fish-cutscene"
      videoTestID="golden-fish-video"
      muted={muted}
      volume={volume}
      onFinish={onFinish}
    />
  );
}
