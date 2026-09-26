type TimedConstruction = { startedAt: string; completesAt: string; serverNow?: string };

export type ConstructionPhase =
  'pre' | 'foundation' | 'building' | 'finishing' | 'awaiting-confirmation';

/** clientNow 와 observedAt 은 같은 기기 시계의 밀리초 값이다. */
export function normalizedConstructionProgress(
  construction: TimedConstruction | null,
  clientNow: number,
  observedAt: number,
): number {
  if (!construction) return 0;
  const startedAt = Date.parse(construction.startedAt);
  const completesAt = Date.parse(construction.completesAt);
  // POST receipt has no serverNow; anchor its initial estimate at startedAt and let the
  // client monotonic tick advance until the next GET supplies the authoritative offset.
  const serverNow = construction.serverNow ? Date.parse(construction.serverNow) : startedAt;
  const duration = completesAt - startedAt;
  if (
    ![startedAt, completesAt, serverNow, clientNow, observedAt].every(Number.isFinite) ||
    duration <= 0
  )
    return 0;
  const estimatedServerNow = serverNow + (clientNow - observedAt);
  return Math.max(0, Math.min(1, (estimatedServerNow - startedAt) / duration));
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
