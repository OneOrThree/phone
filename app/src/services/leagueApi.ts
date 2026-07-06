// league 도메인 API 래퍼 (LeagueController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// 타입은 기존 공용 타입(@/types/api)을 재사용한다(중복 DTO 방지 — 리뷰 반영).
import { api } from '@/services/api';
import type {
  LeagueTierResponse,
  LeagueMemberResponse,
  LeagueRankResponse,
  LeagueScheduleResponse,
} from '@/types/api';
import type { Occupation } from '@/types/dto/user';

// GET /api/v1/league/me/tier — 내 현재 리그·티어 조회.
export async function getMyTier(): Promise<LeagueTierResponse> {
  const { data } = await api.get<LeagueTierResponse>('/api/v1/league/me/tier');
  return data;
}

// GET /api/v1/league/me/ranking?category — 티어 멤버 랭킹. category 미지정: 내 아레나 멤버, 지정: 같은 직군 전역 상위 100명.
// category 값은 서버 Occupation enum 이름(예: 'LABOR_ATTORNEY').
export async function getMyRanking(category?: Occupation): Promise<LeagueMemberResponse[]> {
  const { data } = await api.get<LeagueMemberResponse[]>('/api/v1/league/me/ranking', {
    params: { category },
  });
  return data;
}

// GET /api/v1/league/ranking?scope=total&limit — 전역 전체 유저 랭킹 (GROMO-611).
// 직군·아레나 무관 상위 limit명(기본 100). rank는 아레나가 아닌 전역 순번.
export async function getGlobalRanking(limit?: number): Promise<LeagueMemberResponse[]> {
  const { data } = await api.get<LeagueMemberResponse[]>('/api/v1/league/ranking', {
    params: { scope: 'total', limit },
  });
  return data;
}

// GET /api/v1/league/me/rank — 내 순위·승격/강등 상태 조회.
export async function getMyRank(): Promise<LeagueRankResponse> {
  const { data } = await api.get<LeagueRankResponse>('/api/v1/league/me/rank');
  return data;
}

// GET /api/v1/league/me/schedule — 다음 리그 마감 스케줄(카운트다운용).
export async function getMySchedule(): Promise<LeagueScheduleResponse> {
  const { data } = await api.get<LeagueScheduleResponse>('/api/v1/league/me/schedule');
  return data;
}
