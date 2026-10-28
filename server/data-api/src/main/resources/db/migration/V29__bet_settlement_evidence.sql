-- ════════════════════════════════════════════════════════════════════
-- V29 — 내기 정산 근거 저장 (GROMO-1207)
-- ════════════════════════════════════════════════════════════════════
-- 결과 모달이 "판정에 쓴 실측 분 / 목표 분"을 보여줄 수 있도록 정산 시점 스냅샷을 추가한다.
-- 챌린지 목표는 정산 뒤에도 수정될 수 있어 FK 참조로 재구성하면 소급 오표시가 된다 — 정산이
-- 실제로 쓴 값을 내기·참가 행에 박제한다. 쓰기 지점은 정산 경로(GroupBetSettler)뿐이다.
-- 기존 행은 백필하지 않는다(NULL 유지) — 과거 정산의 실측 분은 재구성할 수 없고(통계·목표가
-- 이후에 변했을 수 있다), 앱은 NULL 을 "기록 없음(—)"으로 그린다.

-- 정산 시점의 목표 분 스냅샷. OPEN·CANCELED 와 V29 이전 정산 행은 NULL.
ALTER TABLE public.group_challenge_bets
    ADD COLUMN goal_minutes integer;

-- 정산 판정에 쓴 참가자별 실측 분. FOCUS 무기록은 0 으로 저장하고(판정도 0 으로 봤다),
-- SCREEN_TIME 미보고는 NULL 로 남긴다 — 0(진짜 0분 사용)과 미계측을 구분해야 앱이 "—" 를 그린다.
ALTER TABLE public.group_challenge_bet_participants
    ADD COLUMN progress_minutes integer;
