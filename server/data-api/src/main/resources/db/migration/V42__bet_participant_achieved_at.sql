-- ════════════════════════════════════════════════════════════════════
-- V42 — 참가 행 조기 확정 시각(achieved_at) (GROMO-1268 · LLD §1.1)
-- ════════════════════════════════════════════════════════════════════
-- LLD §1.1 이 정의한 "조기 확정 시각" 박제 — 개인 승리 조기 확정(confirmWin)이 일어난 순간의
-- Instant 다. 조기 확정 전용이라(정산 시점 판정은 settled_at 이 담당) 정산 경로는 이 컬럼을
-- 건드리지 않는다. 조기 확정이 없던 회차·V42 이전 이력은 null.

ALTER TABLE public.group_challenge_bet_participants
    ADD COLUMN achieved_at timestamp with time zone;
