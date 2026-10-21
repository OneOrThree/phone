import React, { useRef } from 'react';
import { VideoCutscene } from '@/components/VideoCutscene';
import { t } from '@/i18n';
import { sessionGeneration } from '@/services/api/session';

const SOURCE = require('@/assets/ota/cutscenes/departure.mp4');

/** 출항 준비 영상(4초). 출항은 세션 시작·종료와 별개이며, 영상 도중 계정이 바뀌면 이어 가지 않는다. */
export function DepartureStory({
  destination,
  onComplete,
}: {
  destination: string;
  onComplete: () => void;
}) {
  const ownerGeneration = useRef(sessionGeneration()).current;
  return (
    <VideoCutscene
      source={SOURCE}
      accessibilityLabel={t('departureStory.label', { destination })}
      testID="departure-story"
      onFinish={() => {
        if (sessionGeneration() === ownerGeneration) onComplete();
      }}
    />
  );
}
