import React from 'react';
import { DepartureStory } from '@/screens/world/DepartureStory';
import type { State } from '@/services/model';
import { t } from '@/i18n';

/** 먼바다와 집중섬은 같은 출항 세 컷을 쓰고, 끝난 뒤 목적지만 달라진다. */
export function SeaDeparture({ state, onComplete }: { state: State; onComplete: () => void }) {
  return <DepartureStory state={state} destination={t('openSea.name')} onComplete={onComplete} />;
}
