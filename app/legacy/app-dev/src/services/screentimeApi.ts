// screentime 도메인 API 래퍼 (ScreenTimeController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type { ScreenTimeRequest } from '@/types/dto/screentime';

// POST /api/v1/screen-time — 당일 스크린타임 달성 여부 저장(204 No Content).
export async function saveScreenTime(body: ScreenTimeRequest): Promise<void> {
  await api.post('/api/v1/screen-time', body);
}
