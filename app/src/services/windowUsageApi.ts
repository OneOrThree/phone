// SCREEN_TIME×TIME_WINDOW 창 사용분 업로드 API 래퍼 (base /api/v1) — 정본 LLD §2.1.
// 챌린지 배치 파일 소유권에 따라 groupApi.ts(공유 append-only)와 분리된 A2 전유 파일이다.
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';

// PUT .../window-usage 요청 — 클라가 계산한 '그 날짜 창 안의 폰 사용분' 보고.
// 서버는 (challenge, user, usageDate) upsert 멱등 — 중간 보고 허용. 단 measuredAt이 저장값보다
// 오래된 보고는 조용히 204로 무시한다(N34 — 역전 보고가 정산 결과를 네트워크 도착 순서에
// 좌우시키지 않게). 서버 시각 대비 +2분 초과 미래 measuredAt은 거부(INVALID_MEASURED_AT 400).
export interface WindowUsageRequest {
  usageDate: string; // 'YYYY-MM-DD' KST — 내가 참가한 그 챌린지의 OPEN 회차 날짜여야 한다
  progressMinutes: number; // 창 내 사용분(0~1440 — 초과는 서버 검증에 걸린다)
  measuredAt: string; // 측정 시각 ISO instant — 서버가 역전 판정에 쓴다(N34)
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
