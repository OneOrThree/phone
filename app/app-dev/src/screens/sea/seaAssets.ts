import type { ImageSourcePropType } from 'react-native';
import type { Color } from '@/services/model';

export const seaAssets = {
  background: require('@/assets/ota/sea/far-sea.jpg'),
  gulls: require('@/assets/ota/sea/seagulls.png'),
  destination: require('@/assets/ota/sea/destination-island.png'),
  raftBack: require('@/assets/boats/raft/layers/back-day.png'),
  raftFront: require('@/assets/boats/raft/layers/front-day.png'),
};

export const seaLoaf: Record<Color, ImageSourcePropType> = {
  black: require('@/assets/characters/cat/black/loaf/loaf.png'),
  gray: require('@/assets/characters/cat/gray/loaf/loaf.png'),
  calico: require('@/assets/characters/cat/calico/loaf/loaf.png'),
  ginger: require('@/assets/characters/cat/ginger/loaf/loaf.png'),
  white: require('@/assets/characters/cat/white/loaf/loaf.png'),
  cream: require('@/assets/characters/cat/cream/loaf/loaf.png'),
};
