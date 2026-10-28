-- ════════════════════════════════════════════════════════════════════
-- V44 — 참가 행 (user_id, session_id) 인덱스 (GROMO-1415 조회 성능)
-- ════════════════════════════════════════════════════════════════════
-- 참가자 스코프 조회 2종(/me/bet-sessions · /me/challenge-results)은 user_id 를 선두로 걷는데,
-- V39 가 만든 인덱스는 UNIQUE (session_id, user_id) 뿐이라 선두 컬럼이 달라 쓰이지 못한다 —
-- 참가 행 전수 스캔 후 필터가 된다(회차가 쌓일수록 선형 악화). 그룹 탈퇴·계정 탈퇴 연동의
-- "내가 참가 중인 OPEN 회차" 스캔도 같은 축이라 함께 이득을 본다.
-- session_id 를 뒤에 붙여 회차 조인을 인덱스만으로 잇는다(커버링).

CREATE INDEX IF NOT EXISTS idx_group_challenge_bet_participants_user_session
    ON public.group_challenge_bet_participants (user_id, session_id);
