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
  focusFirstDone: 'gromo:focus:firstDone', // 첫 집중 완료 여부 — 결과 화면(603) 변형 분기
  focusPendingUploads: 'gromo:focus:pendingUploads', // 업로드 실패한 집중 세션 재시도 대기열
  focusGoalCelebratedDate: 'gromo:focus:goalCelebratedDate', // 목표 달성 축하 모달을 띄운 날짜(YYYY-MM-DD) — 하루 1회(GROMO-630)
  focusGoalCelebratePending: 'gromo:focus:goalCelebratePending', // 결과 화면이 예약한 축하 {date,days} — 홈 진입 시 노출(GROMO-630)
  subjects: 'gromo:subjects',
  goalPending: 'gromo:goal:pending',
  notificationSettings: 'gromo:settings:notification', // 알림·심야·소리 로컬 캐시(GET 부재 폴백)
  statVisibility: 'gromo:settings:statVisibility', // 통계 공개 범위 로컬 캐시(GET 부재 폴백)
  screentimeAuthGranted: 'gromo:screentime:authGranted',
  screentimeLastRewardedDate: 'gromo:screentime:lastRewardedDate',
  screentimeLastSyncedDate: 'gromo:screentime:lastSyncedDate',
  screentimeSyncState: 'gromo:screentime:syncState', // 마지막 업로드 성공 {userId,date,minutes} — 어제 마감·중복 스킵용(GROMO-633)
  screentimeBucketMonitorRegistered: 'gromo:screentime:bucketMonitorRegistered', // 버킷 모니터링 1회 등록 플래그(기존 유저 마이그레이션)
  screentimeGoalMonitorSeconds: 'gromo:screentime:goalMonitorSeconds', // 목표 판정 모니터링(gromo.daily)에 등록된 목표초 — 변경 감지·재등록용(GROMO-633)
  screentimeLastClosedDate: 'gromo:screentime:lastClosedDate', // 어제분 마감 처리 완료 {userId,date} — 같은 날짜 중복 전송 방지(GROMO-627)
  selectionApplyDate: 'gromo:selection:applyDate',
  selectionConfigured: 'gromo:selection:configured',
  selectionCounts: 'gromo:selection:counts',
  selectionPendingCounts: 'gromo:selection:pendingCounts',
  statsCardOrder: 'gromo:stats:cardOrder', // 통계 카드 순서(탭별) — { DAY: [key...], WEEK: [...], MONTH: [...] }
  groupNotifyRequested: 'gromo:group:notifyRequested', // 그룹 fakedoor '알림 받기' 신청 여부(중복 방지)
  lastAuthProvider: 'gromo:auth:lastProvider', // 마지막 사용 소셜 provider — 재로그인 '최근 사용' 배지(로그아웃 유지·탈퇴 초기화)
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
