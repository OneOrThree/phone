-- ════════════════════════════════════════════════════════════════════
-- V34 — 챌린지 요일 반복 + 수명주기 (GROMO-1260 · GROMO-1261)
-- ════════════════════════════════════════════════════════════════════
-- 1) repeat_days — 도는 요일 비트마스크(§A3). ISO 요일(월=1…일=7)을 1 << (dow-1) 로 접는다:
--    월=1·화=2·수=4·목=8·금=16·토=32·일=64, 매일=127. 0(요일 없음)은 CHECK 로 저장 불가.
--    기존 행은 요일 개념이 없던 시절의 의미 그대로 127(매일) 백필.
-- 2) started_at / ended_at — 이력 표기의 활동 기간(§A8·§A9). 생성 즉시 돌기 시작하므로
--    기존 행은 started_at = created_at 백필.
-- 3) status 'INACTIVE' → 'ENDED' 복원 — V2 가 레거시 ENDED 를 INACTIVE 로 이관해 뒀는데,
--    정책 정본(§A8) 상태도가 ACTIVE → ENDED 라 이름을 정본으로 되돌린다.

-- ── 1) repeat_days ───────────────────────────────────────────────────
ALTER TABLE public.group_challenges
    ADD COLUMN repeat_days smallint;

UPDATE public.group_challenges
SET repeat_days = 127;

ALTER TABLE public.group_challenges
    ALTER COLUMN repeat_days SET NOT NULL;

ALTER TABLE public.group_challenges
    ADD CONSTRAINT group_challenges_repeat_days_check
        CHECK (repeat_days BETWEEN 1 AND 127);

-- ── 2) started_at / ended_at ─────────────────────────────────────────
ALTER TABLE public.group_challenges
    ADD COLUMN started_at timestamp(6) with time zone;

UPDATE public.group_challenges
SET started_at = created_at;

ALTER TABLE public.group_challenges
    ALTER COLUMN started_at SET NOT NULL;

ALTER TABLE public.group_challenges
    ADD COLUMN ended_at timestamp(6) with time zone;

-- ── 3) status INACTIVE → ENDED ──────────────────────────────────────
-- V2 가 이 이름의 CHECK 를 (ACTIVE, INACTIVE) 로 걸어 뒀다 — 드롭 후 값 이관, 정본 이름으로 재생성.
ALTER TABLE public.group_challenges
    DROP CONSTRAINT group_challenges_status_check;

-- 레거시 종료 행의 실제 종료 시각은 유실됐다(당시 컬럼 부재) — created_at 을 근사치로 백필한다
-- (forward-only 수용: dev 리셋 가능, null 로 두면 "ENDED 인데 진행 중 표기" 모순이 남는다).
UPDATE public.group_challenges
SET status   = 'ENDED',
    ended_at = COALESCE(ended_at, created_at)
WHERE status = 'INACTIVE';

ALTER TABLE public.group_challenges
    ADD CONSTRAINT group_challenges_status_check
        CHECK ((status)::text = ANY ((ARRAY[
            'ACTIVE'::character varying,
            'ENDED'::character varying])::text[]));
