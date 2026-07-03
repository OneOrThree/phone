// health 도메인 API 래퍼 (HealthController, base 없음 — 경로 /health).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type { HealthResponse } from '@/types/dto/health';

// GET /health — 서버 상태 확인(평문 문자열 반환).
export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}
