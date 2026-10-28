// league 도메인 API 래퍼 (LeagueController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// 타입은 기존 공용 타입(@/types/api)을 재사용한다(중복 DTO 방지 — 리뷰 반영).
import { api } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';
import type {
  LeagueTierResponse,
  LeagueMemberResponse,
  LeagueRankResponse,
  LeagueScheduleResponse,
  LeagueLastResultResponse,
} from '@/types/api';

// 카테고리 랭킹의 category 값은 서버 Occupation enum 이름(예: 'LABOR_ATTORNEY').
type OccupationCategory = string;

// GET /api/v1/league/me/tier — 내 현재 리그·티어 조회.
export async function getMyTier(): Promise<LeagueTierResponse> {
  const { data } = await api.get<LeagueTierResponse>('/api/v1/league/me/tier');
  return data;
}

// GET /api/v1/league/me/ranking?category&date — 주간 랭킹 상위 100명. category 미지정: 전역(활성 유저 전체),
// 지정: 같은 직군. ⚠️ 어느 쪽도 '나를 포함'을 보장하지 않는다(top-100 리스트일 뿐 — GROMO-818에서 아레나 응답 제거).
// date는 필수(누락 시 서버 400) — 라이브 필드의 '당일 집중분' 기준일로, KST 오늘을 보낸다
// (GROMO-824/854 도입, GROMO-1236에서 KST 이전 — 서버 버킷이 KST고 주 경계도 이미 KST라
// 일 축만 로컬이던 내부 모순 해소. friendsApi.fetchFriends와 동일 패턴).
export async function getMyRanking(
  category?: OccupationCategory,
  date = todayStrKst(),
): Promise<LeagueMemberResponse[]> {
  const params = category ? { category, date } : { date };
  const { data } = await api.get<LeagueMemberResponse[]>('/api/v1/league/me/ranking', {
    params,
  });
  return data;
}

// GET /api/v1/league/ranking?scope=total&limit — 이번 주 전체(ACTIVE 아레나 통합) 랭킹 상위 limit명.
// 전체 평균 비교용: 멤버 totalFocusSeconds 평균을 클라가 계산한다(서버는 리스트만 제공).
export async function getGlobalRanking(limit = 100): Promise<LeagueMemberResponse[]> {
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

// GET /api/v1/league/me/last-result — 주간 마감 결과 조회 (GROMO-567). 결과 없으면 hasResult=false.
export async function getLastResult(): Promise<LeagueLastResultResponse> {
  const { data } = await api.get<LeagueLastResultResponse>('/api/v1/league/me/last-result');
  return data;
}

// POST /api/v1/league/me/last-result/ack — 본 결과(weekStartAt 주차) 확인 처리.
// 대상 없음·이미 확인·중복 호출 모두 서버가 no-op으로 받는 멱등 API.
export async function ackLastResult(weekStartAt: string): Promise<void> {
  await api.post('/api/v1/league/me/last-result/ack', { weekStartAt });
}
