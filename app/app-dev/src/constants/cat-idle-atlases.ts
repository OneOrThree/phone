import type { ImageSourcePropType } from 'react-native';

import type { Color } from '@/services/model';

export type CatIdleAtlasFrame = {
  rect: { x: number; y: number; width: number; height: number };
  footAnchor: { x: number; y: number };
  scale: number;
};

export const CAT_IDLE_ATLASES: Record<Color, ImageSourcePropType> = {
  black: require('@/assets/characters/cat/black/idle/idle-atlas.png'),
  ginger: require('@/assets/characters/cat/ginger/idle/idle-atlas.png'),
  cream: require('@/assets/characters/cat/cream/idle/idle-atlas.png'),
  gray: require('@/assets/characters/cat/gray/idle/idle-atlas.png'),
  white: require('@/assets/characters/cat/white/idle/idle-atlas.png'),
  calico: require('@/assets/characters/cat/calico/idle/idle-atlas.png'),
};

export const CAT_IDLE_ATLAS_SIZES: Record<Color, { width: number; height: number }> = {
  black: { width: 1448, height: 1086 },
  ginger: { width: 1448, height: 1086 },
  cream: { width: 1448, height: 1086 },
  gray: { width: 1448, height: 1086 },
  white: { width: 1448, height: 1086 },
  calico: { width: 1448, height: 1086 },
};

// 실제 알파 영역에 여백 2px을 더한 범위. 하품·기지개·그루밍 순서로 각 4프레임이다.
// scale은 잘라낸 영역의 표시 너비 / 기존 캐릭터 논리 크기다.
// footAnchor.x는 기존 blink 발 중심과 논리 중심의 차이까지 보정한 값이다.
export const CAT_IDLE_ATLAS_FRAMES: Record<Color, readonly CatIdleAtlasFrame[]> = {
  black: [
    {
      rect: { x: 27, y: 26, width: 338, height: 323 },
      footAnchor: { x: 0.47719, y: 0.99381 },
      scale: 0.7563,
    },
    {
      rect: { x: 388, y: 21, width: 334, height: 328 },
      footAnchor: { x: 0.47094, y: 0.9939 },
      scale: 0.74735,
    },
    {
      rect: { x: 753, y: 14, width: 330, height: 334 },
      footAnchor: { x: 0.46752, y: 0.99401 },
      scale: 0.7384,
    },
    {
      rect: { x: 1114, y: 23, width: 330, height: 326 },
      footAnchor: { x: 0.4823, y: 0.99387 },
      scale: 0.7384,
    },
    {
      rect: { x: 27, y: 388, width: 334, height: 322 },
      footAnchor: { x: 0.48599, y: 0.99379 },
      scale: 0.74735,
    },
    {
      rect: { x: 392, y: 404, width: 318, height: 306 },
      footAnchor: { x: 0.57846, y: 0.99346 },
      scale: 0.71155,
    },
    {
      rect: { x: 746, y: 376, width: 326, height: 335 },
      footAnchor: { x: 0.59886, y: 0.99403 },
      scale: 0.72945,
    },
    {
      rect: { x: 1106, y: 389, width: 331, height: 322 },
      footAnchor: { x: 0.47872, y: 0.99379 },
      scale: 0.74064,
    },
    {
      rect: { x: 28, y: 747, width: 335, height: 326 },
      footAnchor: { x: 0.47939, y: 0.99387 },
      scale: 0.74959,
    },
    {
      rect: { x: 394, y: 745, width: 322, height: 327 },
      footAnchor: { x: 0.41059, y: 0.99388 },
      scale: 0.7205,
    },
    {
      rect: { x: 757, y: 745, width: 317, height: 327 },
      footAnchor: { x: 0.41815, y: 0.99388 },
      scale: 0.70931,
    },
    {
      rect: { x: 1119, y: 744, width: 318, height: 328 },
      footAnchor: { x: 0.41119, y: 0.9939 },
      scale: 0.71155,
    },
  ],
  ginger: [
    {
      rect: { x: 27, y: 20, width: 350, height: 340 },
      footAnchor: { x: 0.46868, y: 0.99412 },
      scale: 0.78315,
    },
    {
      rect: { x: 399, y: 17, width: 343, height: 343 },
      footAnchor: { x: 0.47047, y: 0.99417 },
      scale: 0.76749,
    },
    {
      rect: { x: 773, y: 14, width: 339, height: 346 },
      footAnchor: { x: 0.47477, y: 0.99422 },
      scale: 0.75854,
    },
    {
      rect: { x: 1123, y: 21, width: 325, height: 339 },
      footAnchor: { x: 0.47695, y: 0.9941 },
      scale: 0.72721,
    },
    {
      rect: { x: 27, y: 395, width: 344, height: 337 },
      footAnchor: { x: 0.4722, y: 0.99407 },
      scale: 0.76972,
    },
    {
      rect: { x: 409, y: 411, width: 326, height: 321 },
      footAnchor: { x: 0.58284, y: 0.99377 },
      scale: 0.72945,
    },
    {
      rect: { x: 760, y: 384, width: 345, height: 350 },
      footAnchor: { x: 0.61159, y: 0.99429 },
      scale: 0.77196,
    },
    {
      rect: { x: 1122, y: 398, width: 326, height: 335 },
      footAnchor: { x: 0.48369, y: 0.99403 },
      scale: 0.72945,
    },
    {
      rect: { x: 26, y: 767, width: 347, height: 319 },
      footAnchor: { x: 0.46994, y: 1 },
      scale: 0.77644,
    },
    {
      rect: { x: 401, y: 765, width: 337, height: 321 },
      footAnchor: { x: 0.41478, y: 1 },
      scale: 0.75406,
    },
    {
      rect: { x: 775, y: 763, width: 331, height: 323 },
      footAnchor: { x: 0.41779, y: 1 },
      scale: 0.74064,
    },
    {
      rect: { x: 1121, y: 760, width: 327, height: 326 },
      footAnchor: { x: 0.40507, y: 1 },
      scale: 0.73169,
    },
  ],
  cream: [
    {
      rect: { x: 28, y: 23, width: 345, height: 337 },
      footAnchor: { x: 0.46956, y: 0.99407 },
      scale: 0.77196,
    },
    {
      rect: { x: 398, y: 20, width: 340, height: 340 },
      footAnchor: { x: 0.46512, y: 0.99412 },
      scale: 0.76077,
    },
    {
      rect: { x: 773, y: 14, width: 332, height: 346 },
      footAnchor: { x: 0.46591, y: 0.99422 },
      scale: 0.74287,
    },
    {
      rect: { x: 1115, y: 20, width: 333, height: 341 },
      footAnchor: { x: 0.47465, y: 0.99413 },
      scale: 0.74511,
    },
    {
      rect: { x: 25, y: 395, width: 346, height: 339 },
      footAnchor: { x: 0.47535, y: 0.9941 },
      scale: 0.7742,
    },
    {
      rect: { x: 406, y: 411, width: 325, height: 324 },
      footAnchor: { x: 0.57519, y: 0.99383 },
      scale: 0.72721,
    },
    {
      rect: { x: 765, y: 384, width: 336, height: 352 },
      footAnchor: { x: 0.60314, y: 0.99432 },
      scale: 0.75182,
    },
    {
      rect: { x: 1112, y: 399, width: 336, height: 337 },
      footAnchor: { x: 0.47346, y: 0.99407 },
      scale: 0.75182,
    },
    {
      rect: { x: 25, y: 763, width: 347, height: 323 },
      footAnchor: { x: 0.45219, y: 1 },
      scale: 0.77644,
    },
    {
      rect: { x: 399, y: 761, width: 336, height: 325 },
      footAnchor: { x: 0.40372, y: 1 },
      scale: 0.75182,
    },
    {
      rect: { x: 773, y: 761, width: 327, height: 325 },
      footAnchor: { x: 0.41075, y: 1 },
      scale: 0.73169,
    },
    {
      rect: { x: 1116, y: 761, width: 328, height: 325 },
      footAnchor: { x: 0.40246, y: 1 },
      scale: 0.73392,
    },
  ],
  gray: [
    {
      rect: { x: 24, y: 18, width: 351, height: 345 },
      footAnchor: { x: 0.45433, y: 0.9942 },
      scale: 0.78539,
    },
    {
      rect: { x: 398, y: 16, width: 345, height: 347 },
      footAnchor: { x: 0.45227, y: 0.99424 },
      scale: 0.77196,
    },
    {
      rect: { x: 767, y: 13, width: 345, height: 350 },
      footAnchor: { x: 0.45339, y: 0.99429 },
      scale: 0.77196,
    },
    {
      rect: { x: 1116, y: 16, width: 332, height: 347 },
      footAnchor: { x: 0.46017, y: 0.99424 },
      scale: 0.74287,
    },
    {
      rect: { x: 23, y: 397, width: 347, height: 337 },
      footAnchor: { x: 0.47669, y: 0.99407 },
      scale: 0.77644,
    },
    {
      rect: { x: 403, y: 416, width: 333, height: 317 },
      footAnchor: { x: 0.55441, y: 0.99369 },
      scale: 0.74511,
    },
    {
      rect: { x: 765, y: 388, width: 340, height: 345 },
      footAnchor: { x: 0.58364, y: 0.9942 },
      scale: 0.76077,
    },
    {
      rect: { x: 1110, y: 398, width: 338, height: 337 },
      footAnchor: { x: 0.45456, y: 0.99407 },
      scale: 0.7563,
    },
    {
      rect: { x: 21, y: 762, width: 351, height: 324 },
      footAnchor: { x: 0.45999, y: 1 },
      scale: 0.78539,
    },
    {
      rect: { x: 405, y: 757, width: 331, height: 329 },
      footAnchor: { x: 0.39964, y: 1 },
      scale: 0.74064,
    },
    {
      rect: { x: 767, y: 759, width: 338, height: 327 },
      footAnchor: { x: 0.40734, y: 1 },
      scale: 0.7563,
    },
    {
      rect: { x: 1115, y: 760, width: 333, height: 326 },
      footAnchor: { x: 0.39077, y: 1 },
      scale: 0.74511,
    },
  ],
  white: [
    {
      rect: { x: 25, y: 19, width: 347, height: 339 },
      footAnchor: { x: 0.48002, y: 0.9941 },
      scale: 0.77644,
    },
    {
      rect: { x: 395, y: 15, width: 346, height: 345 },
      footAnchor: { x: 0.46808, y: 0.9942 },
      scale: 0.7742,
    },
    {
      rect: { x: 765, y: 10, width: 332, height: 349 },
      footAnchor: { x: 0.46798, y: 0.99427 },
      scale: 0.74287,
    },
    {
      rect: { x: 1105, y: 17, width: 337, height: 343 },
      footAnchor: { x: 0.47769, y: 0.99417 },
      scale: 0.75406,
    },
    {
      rect: { x: 24, y: 391, width: 344, height: 341 },
      footAnchor: { x: 0.48058, y: 0.99413 },
      scale: 0.76972,
    },
    {
      rect: { x: 396, y: 414, width: 333, height: 318 },
      footAnchor: { x: 0.57286, y: 0.99371 },
      scale: 0.74511,
    },
    {
      rect: { x: 751, y: 382, width: 343, height: 350 },
      footAnchor: { x: 0.57384, y: 0.99429 },
      scale: 0.76749,
    },
    {
      rect: { x: 1105, y: 394, width: 339, height: 340 },
      footAnchor: { x: 0.48054, y: 0.99412 },
      scale: 0.75854,
    },
    {
      rect: { x: 26, y: 747, width: 345, height: 334 },
      footAnchor: { x: 0.47337, y: 0.99401 },
      scale: 0.77196,
    },
    {
      rect: { x: 398, y: 747, width: 328, height: 334 },
      footAnchor: { x: 0.40399, y: 0.99401 },
      scale: 0.73392,
    },
    {
      rect: { x: 755, y: 746, width: 325, height: 334 },
      footAnchor: { x: 0.41627, y: 0.99401 },
      scale: 0.72721,
    },
    {
      rect: { x: 1111, y: 749, width: 322, height: 332 },
      footAnchor: { x: 0.41838, y: 0.99398 },
      scale: 0.7205,
    },
  ],
  calico: [
    {
      rect: { x: 27, y: 22, width: 342, height: 340 },
      footAnchor: { x: 0.47778, y: 0.99412 },
      scale: 0.76525,
    },
    {
      rect: { x: 392, y: 20, width: 337, height: 342 },
      footAnchor: { x: 0.47125, y: 0.99415 },
      scale: 0.75406,
    },
    {
      rect: { x: 759, y: 14, width: 337, height: 348 },
      footAnchor: { x: 0.47377, y: 0.99425 },
      scale: 0.75406,
    },
    {
      rect: { x: 1126, y: 21, width: 322, height: 341 },
      footAnchor: { x: 0.49325, y: 0.99413 },
      scale: 0.7205,
    },
    {
      rect: { x: 27, y: 392, width: 342, height: 339 },
      footAnchor: { x: 0.48311, y: 0.9941 },
      scale: 0.76525,
    },
    {
      rect: { x: 397, y: 411, width: 328, height: 321 },
      footAnchor: { x: 0.58693, y: 0.99377 },
      scale: 0.73392,
    },
    {
      rect: { x: 762, y: 391, width: 330, height: 341 },
      footAnchor: { x: 0.62602, y: 0.99413 },
      scale: 0.7384,
    },
    {
      rect: { x: 1119, y: 396, width: 329, height: 337 },
      footAnchor: { x: 0.49327, y: 0.99407 },
      scale: 0.73616,
    },
    {
      rect: { x: 27, y: 754, width: 342, height: 332 },
      footAnchor: { x: 0.48297, y: 0.99398 },
      scale: 0.76525,
    },
    {
      rect: { x: 397, y: 753, width: 330, height: 331 },
      footAnchor: { x: 0.41488, y: 0.99396 },
      scale: 0.7384,
    },
    {
      rect: { x: 761, y: 753, width: 329, height: 332 },
      footAnchor: { x: 0.41171, y: 0.99398 },
      scale: 0.73616,
    },
    {
      rect: { x: 1128, y: 754, width: 320, height: 331 },
      footAnchor: { x: 0.41455, y: 0.99396 },
      scale: 0.71602,
    },
  ],
};
