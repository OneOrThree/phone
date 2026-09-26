import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ObservatoryRankState } from '@/components/village-motion/VillageObservatoryMotion';

type RankSnapshot = { key: string; rank: number | null; found: boolean };

export function observatoryRankStorageKey(userId: string, islandId: string, week: string) {
  return `@gromo/observatory-rank-seen:v1:${encodeURIComponent(userId)}:${encodeURIComponent(islandId)}:${week}`;
}

function decodeRank(raw: string | null): { rank: number | null; found: boolean } {
  if (raw == null) return { rank: null, found: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'rank' in value &&
      ((value as { rank: unknown }).rank === null ||
        (typeof (value as { rank: unknown }).rank === 'number' &&
          Number.isInteger((value as { rank: number }).rank)))
    ) {
      return { rank: (value as { rank: number | null }).rank, found: true };
    }
  } catch {
    // 손상된 로컬 값은 기준점이 없는 것으로 처리한다.
  }
  return { rank: null, found: false };
}

export function useObservatoryRankIndicator({
  active,
  userId,
  islandId,
  week,
  rank,
  viewed,
}: {
  active: boolean;
  userId: string | null;
  islandId: string | null;
  week: string;
  /** undefined는 조회 대기 중, null은 이번 주 아직 순위가 없음을 뜻한다. */
  rank: number | null | undefined;
  viewed: boolean;
}): ObservatoryRankState {
  const key = useMemo(
    () => (active && userId && islandId ? observatoryRankStorageKey(userId, islandId, week) : null),
    [active, islandId, userId, week],
  );
  const [snapshot, setSnapshot] = useState<RankSnapshot | null>(null);
  const visitedSnapshot = useRef<RankSnapshot | null>(null);

  useEffect(() => {
    visitedSnapshot.current = null;
    if (!key) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setSnapshot(null);
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        setSnapshot(
          visitedSnapshot.current?.key === key
            ? visitedSnapshot.current
            : { key, ...decodeRank(raw) },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(
            visitedSnapshot.current?.key === key
              ? visitedSnapshot.current
              : { key, rank: null, found: false },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!key || !viewed || rank === undefined) return;
    const next: RankSnapshot = { key, rank, found: true };
    visitedSnapshot.current = next;
    setSnapshot(next);
    AsyncStorage.setItem(key, JSON.stringify({ rank })).catch(() => undefined);
  }, [key, rank, viewed]);

  if (!key || viewed || rank === undefined || snapshot?.key !== key) return 'normal';
  if (!snapshot.found) return rank === null ? 'normal' : 'rank-updated';
  return snapshot.rank === rank ? 'normal' : 'rank-changed';
}
