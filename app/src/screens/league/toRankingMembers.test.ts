import { toRankingMembers } from './useLeagueRanking';
import type { LeagueMemberResponse } from '@/types/api';

// GROMO-1630 — isFriend 전파 고정 (claude 리뷰 #703 반영).
// RankedMember의 isFriend가 옵셔널이라 toRankingMembers의 명시 매핑 줄이 삭제돼도 tsc가 못
// 잡는다(옵셔널 생략은 타입 에러가 아님). 매핑이 빠지면 서버가 배포돼도 소비처의 ?? false
// 폴백에 영구 고정되므로, 전파를 회귀 테스트로 잠근다.

const base = (over: Partial<LeagueMemberResponse>): LeagueMemberResponse => ({
  rank: 1,
  userId: 'u-other',
  nickname: '상대',
  tierLevel: 2,
  totalFocusSeconds: 600,
  ...over,
});

describe('toRankingMembers — isFriend 전파', () => {
  it('서버 isFriend true/false가 변환 결과에 그대로 살아있다', () => {
    const out = toRankingMembers(
      [base({ userId: 'u-a', isFriend: true }), base({ rank: 2, userId: 'u-b', isFriend: false })],
      'me',
      null,
      null,
    );
    expect(out[0].isFriend).toBe(true);
    expect(out[1].isFriend).toBe(false);
  });

  it('구서버 응답(isFriend 부재)은 undefined 유지 — 소비처 ?? false 폴백 몫', () => {
    const out = toRankingMembers([base({ userId: 'u-a' })], 'me', null, null);
    expect(out[0].isFriend).toBeUndefined();
  });
});
