import { referenceArt } from '@/constants/referenceArt';
import { ImageSourcePropType } from 'react-native';
export const art: Record<string, ImageSourcePropType> = {
  'cat/black/phone': require('@/assets/redesign/cat-black-phone.png'),
  gram: require('@/assets/redesign/gram.png'),
  'bldbg/fire': require('@/assets/redesign/bldbg-fire.jpg'),
  'L/bldbg/fire': require('@/assets/redesign/lbldbg-fire.jpg'),
  // 축음기 화면 배경 — Figma 확정 시안(곡 선택 723-145)의 전용 일러스트. 세로·가로 공통
  'interior/gram': require('@/assets/interiors/gram-cute-v1.png'),
  'ui/crown': require('@/assets/ui/crown.png'),
};

Object.assign(art, referenceArt);
art.fish = require('@/assets/redesign/fish.png');
art['fish/gold'] = require('@/assets/redesign/fish-gold.png');
