// SCREEN_TIME×TIME_WINDOW 창 사용분 업로드 API 래퍼 (B2a GroupController, base /api/v1).
// 챌린지 확장 배치 파일 소유권에 따라 groupApi.ts(A2 전유)와 분리된 A4 전유 파일이다.
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';

// PUT .../window-usage 요청 — 클라가 계산한 '그 날짜 창 안의 폰 사용분' 보고.
// 서버는 (challenge, user, date) upsert 멱등 — 중간 보고 허용, 마지막 값 승리(계약 §2).
export interface WindowUsageRequest {
  date: string; // 'YYYY-MM-DD' — 창의 기준 날짜(자정 걸침 창은 시작 날짜)
  usedMinutes: number; // 창 내 사용분(0~1440 — 초과는 서버 검증에 걸린다)
  measuredAt: string; // 측정 시각 ISO instant
}

// PUT /api/v1/groups/{groupId}/challenges/{challengeId}/window-usage → 204.
// 실패는 호출부에서 무시한다 — upsert 멱등이라 다음 sync에서 최신값으로 재시도하면 된다.
export async function putWindowUsage(
  groupId: string,
  challengeId: string,
  body: WindowUsageRequest,
): Promise<void> {
  await api.put<void>(`/api/v1/groups/${groupId}/challenges/${challengeId}/window-usage`, body);
}
