// 인증 헤더 — 토큰은 seed 단계에서 사전 발급(JwtProvider HS256 계약). 필터는 그대로 타므로
// 파싱 비용은 측정에 포함(prod 동일 경로). endpoint 태그는 remote-write 카디널리티 가드 겸
// 대시보드·summary 집계 축.
export const authParams = (user, endpoint, extra = {}) => ({
  headers: {
    Authorization: `Bearer ${user.token}`,
    'Content-Type': 'application/json',
  },
  tags: { endpoint },
  ...extra,
});
