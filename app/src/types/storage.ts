// AsyncStorage 키 모음. 문자열 리터럴 오타를 방지하기 위해 한 곳에서 관리한다.
// 키 네이밍 규칙은 'gromo:xxx' (CLAUDE.md 참고).
export const STORAGE_KEYS = {
  storageVersion: 'gromo:storageVersion',
  deviceId: 'gromo:deviceId',
  accessToken: 'gromo:accessToken',
  refreshToken: 'gromo:refreshToken',
  user: 'gromo:user',
  onboardingComplete: 'gromo:onboardingComplete',
  focusCategory: 'gromo:focusCategory',
  equipment: 'gromo:equipment',
  ownedItems: 'gromo:ownedItems',
  focus: 'gromo:focus',
  focusLiveSession: 'gromo:focus:liveSession',
  subjects: 'gromo:subjects',
  goalPending: 'gromo:goal:pending',
  notificationSettings: 'gromo:settings:notification', // 알림·심야·소리 로컬 캐시(GET 부재 폴백)
  statVisibility: 'gromo:settings:statVisibility', // 통계 공개 범위 로컬 캐시(GET 부재 폴백)
  screentimeAuthGranted: 'gromo:screentime:authGranted',
  screentimeLastRewardedDate: 'gromo:screentime:lastRewardedDate',
  screentimeLastSyncedDate: 'gromo:screentime:lastSyncedDate',
  selectionApplyDate: 'gromo:selection:applyDate',
  selectionConfigured: 'gromo:selection:configured',
  selectionCounts: 'gromo:selection:counts',
  selectionPendingCounts: 'gromo:selection:pendingCounts',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
