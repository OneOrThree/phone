import React from 'react';
import { DepartureStory } from '@/screens/world/DepartureStory';
import { t } from '@/i18n';
import type { Color } from '@/services/model';
import type { Outfit } from '@/components/CatOutfitLayers';

/** 먼바다와 집중섬은 같은 출항 장면을 쓰고, 끝난 뒤 목적지만 달라진다. */
export function SeaDeparture({
  onComplete,
  color,
  outfit,
}: {
  onComplete: () => void;
  color: Color;
  outfit?: Outfit;
}) {
  return (
    <DepartureStory
      destination={t('openSea.name')}
      color={color}
      outfit={outfit}
      onComplete={onComplete}
    />
  );
}
