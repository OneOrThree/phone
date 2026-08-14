-- ════════════════════════════════════════════════════════════════════
-- V49 — 결과 확인 표시(ack) + 표시 선점(lease) (GROMO-1577 · policy N58·B17·S16)
-- ════════════════════════════════════════════════════════════════════
-- 결과 모달 "1회 노출 가드"의 정본을 앱 로컬 마커에서 서버로 옮긴다(N58). 로컬 단독 가드는
-- 기기 교체·앱 재설치에서 최근 30일 결과 큐가 통째로 재생된다("이미 본 결과"를 다시 축하한다).
--
--   acknowledged_at     — 확인 표시. 리그 league_weekly_results.acknowledged_at 과 같은 모양이고
--                         acknowledged_at IS NULL 조건부 원자 UPDATE 로만 세팅된다(멱등·선점).
--   display_claimed_at  — 표시 선점(lease) 시각. 만료 판정의 기준축이며 ack 시 NULL 로 되돌린다.
--   display_claim_token — 선점 토큰(버전). 앱이 렌더 직전에 자기 선점이 아직 유효한지 대조하고,
--                         ack 은 이 토큰이 일치할 때만 성사된다(만료 후 재선점된 기기의 ack 차단).
--
-- 확인(ack)과 선점(claim)은 다른 상태다(IA §4.3) — 하나로 합치면 "노출 먼저"는 두 기기가 함께
-- 뜨고, "ack 먼저"는 렌더가 중단됐을 때 어느 기기에서도 못 보게 된다.

ALTER TABLE public.group_challenge_bet_participants
    ADD COLUMN acknowledged_at     timestamp with time zone,
    ADD COLUMN display_claimed_at  timestamp with time zone,
    ADD COLUMN display_claim_token uuid;

-- ── 기존 행 백필 (계약 V4) ───────────────────────────────────────────
-- 단순 nullable 로만 배포하면 배포 시각 이전의 결과가 전부 "미확인"이 되어, 재설치·새 기기
-- 사용자가 이미 본 결과를 최대 10건 다시 본다 — N58 이 막으려던 재생이 배포 직후 그대로 난다.
-- 그래서 배포 시각 이전에 이미 존재하던 결과는 확인된 것으로 본다.
--
-- ⚠️ 대상은 "이미 결과가 된 행"뿐이다 — 회차 status 가 결과 4종(SETTLED·FORFEITED·VOIDED·
-- REFUNDED)인 참가 행만 백필한다. OPEN 회차의 참가 행까지 ack 로 칠하면 배포 시점에 진행 중이던
-- 회차가 나중에 정산됐을 때 그 결과를 어느 기기에서도 못 보게 된다(아직 아무도 못 본 결과를
-- 유실한다). 결과 조회(GET /me/challenge-results)가 싣는 집합과 정확히 같은 술어다.
UPDATE public.group_challenge_bet_participants p
SET acknowledged_at = now()
FROM public.group_challenge_bet_sessions s
WHERE p.session_id = s.id
  AND s.status IN ('SETTLED', 'FORFEITED', 'VOIDED', 'REFUNDED');

-- 인덱스는 더하지 않는다 — claim·ack 은 (session_id, user_id) 유니크를,
-- 결과 조회는 V44 의 (user_id, session_id) 를 그대로 탄다. 새 컬럼은 어느 술어에서도 선두가
-- 아니고(유저당 참가 행은 수십~수백 행 규모라 잔여 필터가 싸다), 미확인 개수 배지도 같은
-- (user_id, …) 축의 부분 스캔이라 전용 인덱스가 값을 하지 못한다.
