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

export function mockOccupations(): OccupationResponse[] {
  return [
    { code: 'FOCUS_BUILDING', displayName: '집중력 키우기', sortOrder: 1 },
    { code: 'JOB_PREP', displayName: '취업 준비', sortOrder: 2 },
    { code: 'CODING', displayName: '코딩', sortOrder: 3 },
  ];
}
