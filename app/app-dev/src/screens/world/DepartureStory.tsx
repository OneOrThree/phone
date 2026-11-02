import React, { useRef, useState } from 'react';
import { HarborCutscene } from './HarborCutscene';
import type { Color } from '@/services/model';
import type { Outfit } from '@/components/CatOutfitLayers';
import { t } from '@/i18n';
import { sessionGeneration } from '@/services/api/session';

/** 출항 준비 장면(4초). 연출 도중 계정이 바뀌면 이전 목적지로 이어 가지 않는다. */
export function DepartureStory({
  destination,
  onComplete,
  color,
  outfit,
}: {
  destination: string;
  onComplete: () => void;
  color: Color;
  outfit?: Outfit;
}) {
  const ownerGeneration = useRef(sessionGeneration()).current;
  // 연출 도중 계정이 바뀌면 목적지로 잇지 않고 끝난 장면만 내린다(useIslandSailing 과 같은 처리).
  const [stale, setStale] = useState(false);
  if (stale) return null;
  return (
    <HarborCutscene
      direction="departure"
      color={color}
      outfit={outfit}
      accessibilityLabel={t('departureStory.label', { destination })}
      testID="departure-story"
      onFinish={() => {
        if (sessionGeneration() === ownerGeneration) onComplete();
        else setStale(true);
      }}
    />
  );
}
