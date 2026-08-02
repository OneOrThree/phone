-- ════════════════════════════════════════════════════════════════════
-- V20 — 그룹 챌린지 확장: 내기 상태 확장 + 창 목표분 + 창 사용분 보고 + 활성 중복 DB 강제
-- ════════════════════════════════════════════════════════════════════
-- 1) group_challenge_bets.status CHECK 확장 — FORFEITED(승자 0명 전액 몰수)·CANCELED(개설자 단독 취소) 신설
-- 2) group_challenge_windows.duration_minutes — 창 내 목표 시간(분). nullable: 값 없는 기존 창 챌린지는 계속 판정불가
-- 3) group_challenge_members.usage_date — 스크린타임 창 사용분의 날짜별 보고 저장(미사용 테이블 재활용 + 날짜 차원)
-- 4) group_challenges 활성 (group_id, category, type) 부분 유니크 — check-then-insert 레이스 봉합

-- ── 1) 내기 status CHECK 확장 ──────────────────────────────────────────
-- V19 가 인라인 CHECK 로 만들어 제약명이 마이그레이션에 명시돼 있지 않다. 신선 체인(V1→V19)에선
-- 자동명 group_challenge_bets_status_check 임을 실확인했지만, 이름에 의존하지 않도록 status 컬럼을
-- 참조하는 CHECK 를 찾아 드롭한다 (V14 의 이름-무관 전환 관행).
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.group_challenge_bets'::regclass
          AND c.contype = 'c'
          AND EXISTS (SELECT 1
                      FROM pg_attribute a
                      WHERE a.attrelid = c.conrelid
                        AND a.attname = 'status'
                        AND a.attnum = ANY (c.conkey))
    LOOP
        EXECUTE format('ALTER TABLE public.group_challenge_bets DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE public.group_challenge_bets
    ADD CONSTRAINT group_challenge_bets_status_check
        CHECK ((status)::text = ANY ((ARRAY[
            'OPEN'::character varying,
            'SETTLED'::character varying,
            'REFUNDED'::character varying,
            'FORFEITED'::character varying,
            'CANCELED'::character varying])::text[]));

-- ── 2) 창 목표분 ──────────────────────────────────────────────────────
-- nullable — 목표분 없는 기존 창 챌린지는 종전대로 판정불가(내기 개설 불가)로 남는다.
-- V19 교훈: 뒤 마이그레이션이 이름-무관 드롭을 반복하지 않도록 제약명을 명시한다.
ALTER TABLE public.group_challenge_windows
    ADD COLUMN duration_minutes integer
        CONSTRAINT group_challenge_windows_duration_minutes_check
            CHECK (duration_minutes IS NULL OR duration_minutes > 0);

-- ── 3) 창 사용분 보고 저장 (members 재활용 + 날짜 차원) ─────────────────
-- 이 테이블은 V1 이후 쓰는 코드가 없어 실데이터 0건(Repository 주입처 없음) — 데이터 이관 불필요.
ALTER TABLE public.group_challenge_members
    ADD COLUMN usage_date date;

-- 기존 unique(group_challenge_id, user_id) 는 Hibernate 자동명(ukiwe9880osh6noglltq8seipts)이라
-- 이름-무관으로 드롭한다. pkey 외 유니크 제약은 이것 하나뿐이다.
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.group_challenge_members'::regclass
          AND c.contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE public.group_challenge_members DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

-- 날짜별 보고 1행. usage_date 는 nullable 이라 NULL 끼리는 유니크가 안 걸리지만,
-- 창 사용분 업로드 경로(B2a)는 항상 usage_date 를 채워 쓰므로 NULL 행은 생기지 않는다.
ALTER TABLE public.group_challenge_members
    ADD CONSTRAINT uq_group_challenge_members_challenge_user_date
        UNIQUE (group_challenge_id, user_id, usage_date);

-- ── 4) 활성 챌린지 카테고리×타입당 1개 DB 강제 ─────────────────────────
-- 기존 dev 데이터에 활성 중복이 있으면 인덱스 생성이 실패하므로, 먼저 (group_id, category, type)별
-- 최신 1건(created_at 최신, 동률이면 id 큰 쪽 = UUID v7 시간순)만 남기고 나머지를 soft delete 한다.
UPDATE public.group_challenges gc
SET deleted_at = now()
WHERE gc.status = 'ACTIVE'
  AND gc.deleted_at IS NULL
  AND gc.id NOT IN (SELECT DISTINCT ON (group_id, category, type) id
                    FROM public.group_challenges
                    WHERE status = 'ACTIVE' AND deleted_at IS NULL
                    ORDER BY group_id, category, type, created_at DESC, id DESC);

CREATE UNIQUE INDEX uq_group_challenges_active_cat_type
    ON public.group_challenges (group_id, category, type)
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;
