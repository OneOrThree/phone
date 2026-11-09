import { t } from '@/i18n';
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
      accessibilityLabel={t('ui.shop.goldenFishTeam')}
      testID="golden-fish-cutscene"
      videoTestID="golden-fish-video"
      muted={muted}
      volume={volume}
      onFinish={onFinish}
    />
  );
}
