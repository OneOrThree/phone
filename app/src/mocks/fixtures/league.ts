import type { InternalAxiosRequestConfig } from 'axios';
import type { LeagueLastResultResponse, LeagueMemberResponse } from '@/types/api';

// GROMO-824 스펙(구현 예정) 선반영 목 — 810·811·812 프론트를 백엔드 배포 전에 개발·테스트하기 위한 데이터.
// 824 가 확장하는 것은 GET /league/me/ranking 뿐이다:
//   - category 미지정 = 내 아레나 멤버(811 집중 세션 리그 페이지·리그 탭 로스터) → 라이브 필드 포함
//   - category 지정   = 같은 occupation 전역 상위 100(812 같은 시험 페이지·리그 탭 직군 랭킹) → 라이브 필드 포함
// GET /league/ranking(전체 리그)은 824 범위 밖이라 서버와 동일하게 라이브 필드 없이 응답한다.
// 랭킹 화면은 응답의 userId 가 실제 로그인 유저와 일치하는 행을 '나'로 인식하므로,
// 요청 JWT 의 sub 를 디코드해 내 행을 만들어 준다.

const LOADED_AT = Date.now();
const minutesBeforeLoad = (m: number): string => new Date(LOADED_AT - m * 60_000).toISOString();

// JWT sub 디코드 — api.ts 의 getUserIdFromToken 과 동일 로직.
// api.ts 가 mocks 를 import 하므로(순환 방지) 여기서 최소 구현을 중복해 둔다.
function userIdFromAuthHeader(config: InternalAxiosRequestConfig): string {
  const auth = config.headers?.Authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : null;
  if (!token) return '00000000-0000-0000-0000-0000000000aa';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { sub?: string };
    return decoded.sub ?? '00000000-0000-0000-0000-0000000000aa';
  } catch {
    return '00000000-0000-0000-0000-0000000000aa';
  }
}

// 내 아레나 멤버 (GET /league/me/ranking, category 미지정) — 811·리그 탭 로스터.
// 케이스: 집중중(태그有)/집중중(무태그)/미집중/나 — 그리드·랭킹 분기 커버
export function mockArenaRanking(config: InternalAxiosRequestConfig): LeagueMemberResponse[] {
  return [
    {
      rank: 1,
      userId: '00000000-0000-0000-0000-000000000101',
      nickname: '아레나1등',
      tierLevel: 1,
      totalFocusSeconds: 75600,
      isFocusing: true,
      focusTimeMinutes: 180,
      focusStartedAt: minutesBeforeLoad(23),
      focusTagName: '민법',
    },
    {
      rank: 2,
      userId: userIdFromAuthHeader(config),
      nickname: '나',
      tierLevel: 2,
      totalFocusSeconds: 58800,
      isFocusing: false,
      focusTimeMinutes: 45,
      focusStartedAt: null,
      focusTagName: null,
    },
    {
      rank: 3,
      userId: '00000000-0000-0000-0000-000000000103',
      nickname: '무태그러',
      tierLevel: 3,
      totalFocusSeconds: 45600,
      isFocusing: true,
      focusTimeMinutes: 120,
      focusStartedAt: minutesBeforeLoad(51),
      focusTagName: null,
    },
    {
      rank: 4,
      userId: '00000000-0000-0000-0000-000000000104',
      nickname: '수학러',
      tierLevel: 4,
      totalFocusSeconds: 32400,
      isFocusing: true,
      focusTimeMinutes: 200,
      focusStartedAt: minutesBeforeLoad(8),
      focusTagName: '수학',
    },
    {
      rank: 5,
      userId: '00000000-0000-0000-0000-000000000105',
      nickname: '쉬는중',
      tierLevel: 5,
      totalFocusSeconds: 18000,
      isFocusing: false,
      focusTimeMinutes: 0,
      focusStartedAt: null,
      focusTagName: null,
    },
  ];
}

// 같은 occupation 전역 상위 (GET /league/me/ranking?category=) — 812·리그 탭 직군 랭킹.
// 아레나와 다른 인물 구성으로 화면이 실제로 달라지는지 확인할 수 있게 한다.
export function mockCategoryRanking(config: InternalAxiosRequestConfig): LeagueMemberResponse[] {
  return [
    {
      rank: 1,
      userId: '00000000-0000-0000-0000-000000000201',
      nickname: '같은시험1등',
      tierLevel: 1,
      totalFocusSeconds: 126000,
      isFocusing: true,
      focusTimeMinutes: 240,
      focusStartedAt: minutesBeforeLoad(12),
      focusTagName: '헌법',
    },
    {
      rank: 2,
      userId: '00000000-0000-0000-0000-000000000202',
      nickname: '새벽공부러',
      tierLevel: 2,
      totalFocusSeconds: 108000,
      isFocusing: true,
      focusTimeMinutes: 310,
      focusStartedAt: minutesBeforeLoad(95),
      focusTagName: '영어',
    },
    {
      rank: 3,
      userId: '00000000-0000-0000-0000-000000000203',
      nickname: '조용한경쟁자',
      tierLevel: 3,
      totalFocusSeconds: 90000,
      isFocusing: false,
      focusTimeMinutes: 220,
      focusStartedAt: null,
      focusTagName: null,
    },
    {
      rank: 4,
      userId: userIdFromAuthHeader(config),
      nickname: '나',
      tierLevel: 4,
      totalFocusSeconds: 58800,
      isFocusing: false,
      focusTimeMinutes: 45,
      focusStartedAt: null,
      focusTagName: null,
    },
    {
      rank: 5,
      userId: '00000000-0000-0000-0000-000000000205',
      nickname: '막판스퍼트',
      tierLevel: 5,
      totalFocusSeconds: 25200,
      isFocusing: true,
      focusTimeMinutes: 60,
      focusStartedAt: minutesBeforeLoad(3),
      focusTagName: null,
    },
    {
      rank: 6,
      userId: '00000000-0000-0000-0000-000000000206',
      nickname: '노동법러',
      tierLevel: 2,
      totalFocusSeconds: 22800,
      isFocusing: true,
      focusTimeMinutes: 110,
      focusStartedAt: minutesBeforeLoad(40),
      focusTagName: '노동법',
    },
  ];
}

// 주간 마감 결과 (GET /league/me/last-result) — 831 결과 연출·ack 흐름 확인용.
// ack 상태를 목 안에 유지해 '결과 화면 닫기 → 리그 탭 재진입 시 재노출 안 됨'을 목 모드에서
// 그대로 검증한다(앱 재시작 시 초기화). 유지/강등 연출을 보려면 아래 result·티어·시간을 바꾼다:
//   유지 STAY 4→4 / 강등 RELEGATED 4→3 (강등은 깨진 뱃지 3단계 연출)
const MOCK_WEEK_START_AT = new Date(LOADED_AT - 7 * 24 * 60 * 60_000).toISOString();
let mockLastResultAcknowledged = false;

export function mockLastResult(): LeagueLastResultResponse {
  return {
    hasResult: true,
    weekStartAt: MOCK_WEEK_START_AT,
    result: 'PROMOTED',
    previousTierLevel: 3,
    newTierLevel: 4,
    focusSeconds: 172800, // 48h — 다음 티어(56h) 기준 '8시간 더' 문구 확인용
    // 승급 보상 시간조각 — 화면이 서버 값만 신뢰하므로(GROMO-1193, 클라 공식 폴백 제거)
    // 목 모드에서도 배지를 보려면 여기 실제 지급액이 있어야 한다. 서버 공식 기준
    // 도달 티어 4(갓생러) = 200 (CurrencyRewardPolicy.leaguePromotionReward).
    promotionBonusCoins: 200,
    acknowledged: mockLastResultAcknowledged,
  };
}

export function mockAckLastResult(): void {
  mockLastResultAcknowledged = true;
}

// 전체 리그 (GET /league/ranking?scope=total) — 824 범위 밖이라 라이브 필드 없이 기존 계약 그대로.
// 전체 탭(useGlobalRanking)이 라이브 없이도 기존 표기로 폴백하는지 검증하는 용도.
export function mockGlobalRanking(config: InternalAxiosRequestConfig): LeagueMemberResponse[] {
  return [
    {
      rank: 1,
      userId: '00000000-0000-0000-0000-000000000301',
      nickname: '전체1등',
      tierLevel: 1,
      totalFocusSeconds: 192000,
    },
    {
      rank: 2,
      userId: '00000000-0000-0000-0000-000000000302',
      nickname: '전체2등',
      tierLevel: 2,
      totalFocusSeconds: 174000,
    },
    {
      rank: 3,
      userId: userIdFromAuthHeader(config),
      nickname: '나',
      tierLevel: 3,
      totalFocusSeconds: 58800,
    },
  ];
}
