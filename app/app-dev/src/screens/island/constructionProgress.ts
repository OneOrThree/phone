type TimedConstruction = { startedAt: string | number; completesAt: string | number };

export type ConstructionPhase =
  'pre' | 'foundation' | 'building' | 'finishing' | 'awaiting-confirmation';

const timestamp = (value: string | number) =>
  typeof value === 'number' ? value : Date.parse(value);

/** 착공 POST가 준 구간에서 클라이언트 현재 시각으로 진행률을 계산한다. */
export function normalizedConstructionProgress(
  construction: TimedConstruction | null,
  clientNow: number,
): number {
  if (!construction) return 0;
  const startedAt = timestamp(construction.startedAt);
  const completesAt = timestamp(construction.completesAt);
  const duration = completesAt - startedAt;
  if (![startedAt, completesAt, clientNow].every(Number.isFinite) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, (clientNow - startedAt) / duration));
}

export function constructionPhase(
  progress: number,
  hasActiveConstruction = true,
): ConstructionPhase {
  if (!hasActiveConstruction) return 'pre';
  if (!Number.isFinite(progress) || progress < 0.15) return 'foundation';
  if (progress < 0.75) return 'building';
  if (progress < 1) return 'finishing';
  return 'awaiting-confirmation';
}
