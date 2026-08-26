-- ════════════════════════════════════════════════════════════════════
-- V36 — 하루형 목표 상한 DB 강제 + 활성 유니크 완화 (GROMO-1405 · GROMO-1422 · N51 · FR-1·3)
-- ════════════════════════════════════════════════════════════════════
-- 1) 부모 UNIQUE (id, category) — 자식 복합 FK 의 참조 대상(부분 인덱스 아님). PK(id)와 부분
--    유니크만으로는 Postgres 가 FOREIGN KEY (challenge_id, category) 를 거부한다(LLD §1.2).
-- 2) group_challenge_durations 에 category 비정규화 복사 + 복합 FK + 카테고리별 상한 CHECK —
--    FOCUS 1~1080(18h) · SCREEN_TIME 1~720(12h). 단일 BETWEEN 1 AND 1440(V28)은 서비스 검증을
--    우회하는 경로(배치·수동 SQL)에서 상한 밖 값이 저장될 수 있고, 챌린지는 불변(§A7)이라
--    되돌릴 수 없다 — 상한을 DB 가 보증한다.
-- 3) V20 부분 유니크 완화(FR-3) — 하루형(DURATION)만 카테고리당 활성 1개, 창형은 겹침 검사
--    (서비스, 그룹 행 배타 락)만 통과하면 복수 허용.
-- 4) 활성 목록 부분 인덱스 — 목록 조회·활성 4개 상한(FR-1) 검사 경로.

-- ── 0) 사전 검사 — OPEN 내기가 걸린 상한 초과 하루형이 있으면 여기서 멈춘다 ──
-- 클램프는 목표값을 바꾼다. OPEN 내기가 걸린 챌린지의 목표를 바꾸면 참가자가 돈을 건 시점과
-- 다른 조건으로 판정된다(돈 경로 — 정산은 되돌리지 않는다 §B8). 그런 행은 무조건 고치지 않고
-- 운영자가 해당 내기를 먼저 정산/무효화한 뒤 재실행하게 명시적으로 중단한다(V35 사전 검사 패턴).
-- OPEN 내기가 없는 초과 행만 아래 3)에서 경계 클램프된다.
DO $$
DECLARE
    blocked integer;
BEGIN
    SELECT count(*)
    INTO blocked
    FROM public.group_challenge_durations d
             JOIN public.group_challenges c ON c.id = d.challenge_id
    WHERE ((c.category = 'FOCUS' AND d.duration_minutes > 1080)
        OR (c.category = 'SCREEN_TIME' AND d.duration_minutes > 720))
      AND EXISTS (SELECT 1
                  FROM public.group_challenge_bets b
                  WHERE b.challenge_id = d.challenge_id
                    AND b.status = 'OPEN');
    IF blocked > 0 THEN
        RAISE EXCEPTION 'V36 중단 — OPEN 내기가 걸린 상한 초과 하루형 % 건 존재. 클램프하면 참가 시점과 다른 목표로 판정된다 — 해당 내기를 정산/무효화한 뒤 재실행할 것 (N51 · GROMO-1405)', blocked;
    END IF;
END $$;

-- ── 1) 부모 UNIQUE (id, category) ────────────────────────────────────
ALTER TABLE public.group_challenges
    ADD CONSTRAINT uq_group_challenges_id_category UNIQUE (id, category);

-- ── 2) durations.category 복사 + 상한 CHECK ─────────────────────────
ALTER TABLE public.group_challenge_durations
    ADD COLUMN category character varying(255);

UPDATE public.group_challenge_durations d
SET category = c.category
FROM public.group_challenges c
WHERE c.id = d.challenge_id;

ALTER TABLE public.group_challenge_durations
    ALTER COLUMN category SET NOT NULL;

-- 부모와의 값 일치는 복합 FK 가 보증한다 — 서비스가 다른 카테고리를 넣으면 FK 위반으로 거절된다.
ALTER TABLE public.group_challenge_durations
    ADD CONSTRAINT fk_group_challenge_durations_challenge_category
        FOREIGN KEY (challenge_id, category)
            REFERENCES public.group_challenges (id, category);

-- CHECK 교체 전에 상한 밖 기존 행을 경계값으로 클램프한다(V28 관행 — plain CHECK 는 기존 행을
-- 즉시 검증하므로 위반 행이 있으면 배포(부팅)가 막힌다). 상한 초과 목표는 어차피 UI 가 거부하는
-- 값이라 경계 클램프가 의미 보존에 가장 가깝다. 여기 도달한 초과 행에는 OPEN 내기가 없음이
-- 0) 사전 검사로 보증돼 있다 — 목표 변경이 진행 중인 돈 경로를 건드리지 않는다.
UPDATE public.group_challenge_durations
SET duration_minutes = 1080
WHERE category = 'FOCUS' AND duration_minutes > 1080;

UPDATE public.group_challenge_durations
SET duration_minutes = 720
WHERE category = 'SCREEN_TIME' AND duration_minutes > 720;

-- V28 이 이름을 명시해 만든 CHECK — 이름으로 바로 드롭하고 카테고리별 상한으로 교체한다.
ALTER TABLE public.group_challenge_durations
    DROP CONSTRAINT group_challenge_durations_duration_minutes_check;

ALTER TABLE public.group_challenge_durations
    ADD CONSTRAINT group_challenge_durations_duration_minutes_check
        CHECK ((category = 'FOCUS' AND duration_minutes BETWEEN 1 AND 1080)
            OR (category = 'SCREEN_TIME' AND duration_minutes BETWEEN 1 AND 720));

-- ── 3) V20 부분 유니크 완화 — 하루형만 카테고리당 활성 1개 ───────────────
-- 완화 방향이라 기존 데이터 위반은 불가능하다(종전 인덱스가 더 엄격했다) — 정리 UPDATE 불필요.
DROP INDEX public.uq_group_challenges_active_cat_type;

CREATE UNIQUE INDEX uq_group_challenges_active_duration_category
    ON public.group_challenges (group_id, category)
    WHERE type = 'DURATION' AND status = 'ACTIVE' AND deleted_at IS NULL;

-- ── 4) 활성 목록 부분 인덱스 (FR-1 상한 검사·카드 목록) ──────────────────
CREATE INDEX idx_group_challenges_active_group
    ON public.group_challenges (group_id)
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;
