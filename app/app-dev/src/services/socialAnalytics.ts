import { AppState } from 'react-native';
import { getFriendsScreen } from '@/services/api/friends';
import { myIslands } from '@/services/api/islands';
import { getSession, sessionGeneration, subscribeSession } from '@/services/api/session';
import { captureProductEvent, getPostHogClient } from '@/services/posthog';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** 닉네임·상대 ID는 전송하지 않는다. 잘못된 응답도 친구 0명으로 해석하지 않는다. */
function uniqueCount(items: unknown, key: string): number | undefined {
  if (!Array.isArray(items)) return undefined;
  const ids: string[] = [];
  for (const item of items) {
    if (!item || typeof item[key] !== 'string' || !item[key]) return undefined;
    ids.push(item[key]);
  }
  return new Set(ids).size;
}

/** 인증 식별 구독 이후 시작한다. 화면 방문 여부와 무관하게 최근 활동자의 관계 상태를 관측한다. */
export function startSocialAnalytics(): () => void {
  if (!getPostHogClient()) return () => {};

  let disposed = false;
  let previousAppState = AppState.currentState;
  let observedGeneration = -1;
  let observedUserId: string | undefined;
  let lastSnapshotAt = -Infinity;
  let pending: object | undefined;

  const activate = () => {
    const session = getSession();
    if (disposed || !session || AppState.currentState === 'background') return;
    captureProductEvent('app_active', { analytics_schema_version: 1 });
    if (pending || Date.now() - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;

    const generation = sessionGeneration();
    const request = {};
    pending = request;
    lastSnapshotAt = Date.now();
    void Promise.allSettled([myIslands(), getFriendsScreen()])
      .then(([islands, friends]) => {
        if (
          disposed ||
          generation !== sessionGeneration() ||
          session.userId !== getSession()?.userId
        )
          return;

        const islandCount =
          islands.status === 'fulfilled' && islands.value?.nextCursor === null
            ? uniqueCount(islands.value.items, 'id')
            : undefined;
        const friendCount =
          friends.status === 'fulfilled'
            ? uniqueCount(friends.value?.friends, 'userId')
            : undefined;

        captureProductEvent('social_state_observed', {
          analytics_schema_version: 1,
          island_status:
            islandCount === undefined ? 'unknown' : islandCount > 0 ? 'member' : 'drifting',
          ...(islandCount === undefined ? {} : { island_count: islandCount }),
          friend_bucket:
            friendCount === undefined
              ? 'unknown'
              : friendCount === 0
                ? '0'
                : friendCount === 1
                  ? '1'
                  : friendCount < 5
                    ? '2-4'
                    : '5+',
          ...(friendCount === undefined ? {} : { friend_count: friendCount }),
        });
      })
      .catch(() => {})
      .finally(() => {
        if (pending === request) pending = undefined;
      });
  };

  const unsubscribe = subscribeSession((session) => {
    const generation = sessionGeneration();
    if (generation === observedGeneration && session?.userId === observedUserId) return;
    observedGeneration = generation;
    observedUserId = session?.userId;
    lastSnapshotAt = -Infinity;
    pending = undefined;
    if (session) activate();
  });
  const appStateSubscription = AppState.addEventListener('change', (next) => {
    const becameActive = next === 'active' && previousAppState !== 'active';
    previousAppState = next;
    if (becameActive) activate();
  });

  return () => {
    disposed = true;
    unsubscribe();
    appStateSubscription.remove();
  };
}
