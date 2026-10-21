import type { ImageSourcePropType } from 'react-native';
import type { Color } from '@/services/model';

export const seaAssets = {
  background: require('@/assets/ota/sea/far-sea.jpg'),
  gulls: require('@/assets/ota/sea/seagulls.png'),
  destination: require('@/assets/ota/sea/destination-island.png'),
  raftBack: require('@/assets/boats/raft/layers/back-day.png'),
  raftFront: require('@/assets/boats/raft/layers/front-day.png'),
};

/** 망원경 바다(GROMO-2317) — 1024×1536 원화, 수평선은 위에서 545px. 화면은 cover 가운데 맞춤으로 그려 이 값으로 수평선을 잰다. */
export const telescopeSea = {
  source: require('@/assets/ota/sea/telescope-sea.jpg') as ImageSourcePropType,
  width: 1024,
  height: 1536,
  horizon: 545,
};

/** 망원경을 든 고양이 뗏목(GROMO-2317) — 털색마다 한 장, 600×471. */
export const raftTelescope: Record<Color, ImageSourcePropType> = {
  black: require('@/assets/ota/sea/raft-telescope/black.png'),
  gray: require('@/assets/ota/sea/raft-telescope/gray.png'),
  calico: require('@/assets/ota/sea/raft-telescope/calico.png'),
  ginger: require('@/assets/ota/sea/raft-telescope/ginger.png'),
  white: require('@/assets/ota/sea/raft-telescope/white.png'),
  cream: require('@/assets/ota/sea/raft-telescope/cream.png'),
};
export const RAFT_TELESCOPE_ASPECT = 600 / 471;

export const seaLoaf: Record<Color, ImageSourcePropType> = {
  black: require('@/assets/characters/cat/black/loaf/loaf.png'),
  gray: require('@/assets/characters/cat/gray/loaf/loaf.png'),
  calico: require('@/assets/characters/cat/calico/loaf/loaf.png'),
  ginger: require('@/assets/characters/cat/ginger/loaf/loaf.png'),
  white: require('@/assets/characters/cat/white/loaf/loaf.png'),
  cream: require('@/assets/characters/cat/cream/loaf/loaf.png'),
};
