import type { ImageSourcePropType } from 'react-native';

export type ConstructionBuildingId =
  'hall' | 'board' | 'gram' | 'library' | 'mail' | 'tower' | 'shop';
export type ConstructionPhase = 'foundation' | 'structure' | 'finishing' | 'completion';

export type ConstructionSpriteCell = Readonly<{
  atlas: ImageSourcePropType;
  row: number;
  rows: number;
  column: number;
}>;

const firstAtlas = require('@/assets/village-world/construction/hall-board-gram-library-atlas.png');
const secondAtlas = require('@/assets/village-world/construction/mail-tower-shop-atlas.png');
export const constructionEffectsAtlas = require('@/assets/village-world/construction/effects-atlas.png');

// Atlases are four columns wide: foundation, frame, finishing, completion anticipation.
const columns: Readonly<Record<ConstructionPhase, number>> = {
  foundation: 0,
  structure: 1,
  finishing: 2,
  completion: 3,
};

export const constructionBuildingMotion: Readonly<
  Record<ConstructionBuildingId, Readonly<Record<ConstructionPhase, ConstructionSpriteCell>>>
> = {
  hall: stages(firstAtlas, 0, 4),
  board: stages(firstAtlas, 1, 4),
  gram: stages(firstAtlas, 2, 4),
  library: stages(firstAtlas, 3, 4),
  mail: stages(secondAtlas, 0, 3),
  tower: stages(secondAtlas, 1, 3),
  shop: stages(secondAtlas, 2, 3),
};

function stages(
  atlas: ImageSourcePropType,
  row: number,
  rows: number,
): Readonly<Record<ConstructionPhase, ConstructionSpriteCell>> {
  return {
    foundation: { atlas, row, rows, column: columns.foundation },
    structure: { atlas, row, rows, column: columns.structure },
    finishing: { atlas, row, rows, column: columns.finishing },
    completion: { atlas, row, rows, column: columns.completion },
  };
}

// 작업 burst 안에서만 쓰는 작은 좌우 진동. 긴 공사 시간 전체를 계속 흔들지 않는다.
export const constructionMotionOffsets = [0, -0.6, 0.6, 0] as const;
export const constructionMotionFrameMs = 400;
export const constructionEffectFrameMs = 200;
export const constructionBurstMs: Readonly<Record<ConstructionPhase, number>> = {
  foundation: 1400,
  structure: 1800,
  finishing: 1200,
  completion: 800,
};

const constructionRestRangeMs: Readonly<Record<ConstructionPhase, readonly [number, number]>> = {
  foundation: [5000, 8000],
  structure: [4000, 6500],
  finishing: [6500, 10_000],
  completion: [10_000, 15_000],
};

const buildingSeed: Readonly<Record<ConstructionBuildingId, number>> = {
  hall: 1,
  board: 2,
  gram: 3,
  library: 4,
  mail: 5,
  tower: 6,
  shop: 7,
};

const phaseSeed: Readonly<Record<ConstructionPhase, number>> = {
  foundation: 11,
  structure: 23,
  finishing: 37,
  completion: 53,
};

/** 건물들이 같은 박자로 움직이지 않도록 재현 가능한 휴지기를 만든다. */
export function constructionRestMs(
  building: ConstructionBuildingId,
  phase: ConstructionPhase,
  cycle: number,
): number {
  const [min, max] = constructionRestRangeMs[phase];
  const spread = max - min;
  const offset = (buildingSeed[building] * 977 + phaseSeed[phase] * 571 + cycle * 1597) % spread;
  return min + offset;
}
export const constructionEffectRows: Readonly<Record<ConstructionPhase, number>> = {
  foundation: 0,
  structure: 1,
  finishing: 2,
  completion: 2,
};
export const constructionEffectFrameCount = 4;
