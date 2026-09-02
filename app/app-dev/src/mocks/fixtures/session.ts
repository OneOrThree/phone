import type { LoginResult } from '@/types/api';
import type { OccupationResponse, UserProfileResponse } from '@/types/dto/user';

export const MOCK_GUEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';

// 서명 검증은 서버의 책임이고 목 모드는 네트워크를 타지 않는다. 클라이언트의 sub/exp 파싱과
// 세션 저장 계약만 실제 JWT와 같은 모양으로 통과시키는 장기 만료 개발 토큰이다.
const MOCK_ACCESS_TOKEN =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwYWEiLCJleHAiOjQxMDI0NDQ4MDAsImlhdCI6MTc4NjUwMDAwMH0.mock';

export function mockGuestLogin(): LoginResult & { refreshToken: string } {
  return {
    accessToken: MOCK_ACCESS_TOKEN,
    refreshToken: 'mock-refresh-token',
    isNewUser: true,
    isGuest: true,
    timeZone: 'Asia/Seoul',
  };
}

export function mockCurrentUserProfile(): UserProfileResponse {
  return {
    id: MOCK_GUEST_USER_ID,
    nickname: 'QA 게스트',
    currency: 500,
    dailyScreenTimeGoalMinutes: 120,
    dailyFocusTimeGoalMinutes: 60,
    countryCode: 'KR',
    statVisibility: 'PUBLIC',
    occupation: 'FOCUS_BUILDING',
    timeZone: 'Asia/Seoul',
  };
}

// GET /occupations — 표시명의 유일한 소스라(GROMO-1624) 모의값도 서버 19종을 전부 담는다.
// 일부만 두면 mock 모드에서 온보딩·설정의 시험 목록이 비어 보인다.
export function mockOccupations(): OccupationResponse[] {
  return [
    { code: 'LABOR_ATTORNEY', displayName: '노무사', sortOrder: 1 },
    { code: 'PATENT_ATTORNEY', displayName: '변리사', sortOrder: 2 },
    { code: 'TAX_ACCOUNTANT', displayName: '세무사', sortOrder: 3 },
    { code: 'CPA', displayName: '회계사', sortOrder: 4 },
    { code: 'APPRAISER', displayName: '감정평가사', sortOrder: 5 },
    { code: 'CIVIL_SERVANT', displayName: '공무원', sortOrder: 6 },
    { code: 'POLICE_FIRE', displayName: '경찰·소방', sortOrder: 7 },
    { code: 'ADMIN_EXAM', displayName: '행정고시', sortOrder: 8 },
    { code: 'CERTIFICATION', displayName: '자격증', sortOrder: 9 },
    { code: 'MIDDLE_SCHOOL', displayName: '중학생', sortOrder: 10 },
    { code: 'HIGH_SCHOOL', displayName: '고등학생', sortOrder: 11 },
    { code: 'CSAT', displayName: '수능·N수', sortOrder: 12 },
    { code: 'UNIVERSITY', displayName: '대학생', sortOrder: 13 },
    { code: 'JOB_PREP', displayName: '취업 준비', sortOrder: 14 },
    { code: 'ENGLISH_TEST', displayName: '토익·토플', sortOrder: 15 },
    { code: 'CODING', displayName: '코딩', sortOrder: 16 },
    { code: 'SELF_DEVELOPMENT', displayName: '자기계발', sortOrder: 17 },
    { code: 'FOCUS_BUILDING', displayName: '집중력 키우기', sortOrder: 18 },
    { code: 'ETC', displayName: '기타', sortOrder: 19 },
  ];
}
