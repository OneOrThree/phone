import React from 'react';
import { DepartureStory } from '@/screens/world/DepartureStory';
import { t } from '@/i18n';

/** 먼바다와 집중섬은 같은 출항 영상을 쓰고, 끝난 뒤 목적지만 달라진다. */
export function SeaDeparture({ onComplete }: { onComplete: () => void }) {
  return <DepartureStory destination={t('openSea.name')} onComplete={onComplete} />;
}
