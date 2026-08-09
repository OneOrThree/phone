-- ════════════════════════════════════════════════════════════════════
-- V32 — 챌린지 스키마 기반 공사
--   GROMO-1260 요일 반복(repeat_days) · GROMO-1261 started_at/ended_at ·
--   GROMO-1263 창 시각 time 전환 · GROMO-1264 stake 상한 CHECK ·
--   GROMO-1265 members 잔재 컬럼 제거 · GROMO-1266 usage_date NOT NULL ·
--   GROMO-1267 total_screen_time_minutes nullable
-- ════════════════════════════════════════════════════════════════════
-- 순서 규약(V2·V28 교훈): 기존 행 정규화 UPDATE → 구 제약 드롭 → 새 제약 ADD.
--   plain CHECK 와 SET NOT NULL 은 기존 행을 즉시 검증하므로 위반 행이 하나라도 있으면
--   이 마이그레이션이 실패해 배포(부팅)가 막힌다.
-- 번호: 직전 최대는 V31. V24 는 결번이지만 재사용하지 않는다 — dev 는 out-of-order 허용이지만
--   prod 는 미적용이라 뒤늦게 끼운 낮은 번호는 prod 에서 영원히 적용되지 않는다.
-- 실 SQL 검증은 GroupChallengeV32MigrationTest 가 맡는다(ci 프로파일은 Flyway OFF).

-- ── 1) 요일 반복 repeat_days (GROMO-1260) ─────────────────────────────
-- ISO-8601 요일 번호(월=1 … 일=7)를 1 << (dow - 1) 로 접은 비트마스크. 평일=31, 매일=127.
-- 기존 행은 127(매일)로 백필한다 — 요일 개념이 없던 시절의 챌린지는 매일 도는 것이 현행 동작이라
-- 127 이 의미 보존이다. NOT NULL 을 세우기 전에 백필해야 한다(SET NOT NULL 은 즉시 검증).
ALTER TABLE public.group_challenges
    ADD COLUMN repeat_days smallint;

UPDATE public.group_challenges SET repeat_days = 127 WHERE repeat_days IS NULL;

ALTER TABLE public.group_challenges
    ALTER COLUMN repeat_days SET NOT NULL;

-- 0(요일 하나도 없음)은 저장 불가 — "언제 도는지"를 반드시 고르게 하는 정책(§A3)의 최후 방어선.
-- 기본값(DEFAULT)을 일부러 두지 않는다: 값을 안 넣은 코드 경로가 조용히 "매일"이 되면 안 된다.
ALTER TABLE public.group_challenges
    ADD CONSTRAINT group_challenges_repeat_days_check
        CHECK (repeat_days BETWEEN 1 AND 127);

-- ── 2) 활동 기간 started_at / ended_at (GROMO-1261) ───────────────────
-- 기존 행은 created_at 으로 백필한다(생성 = 시작이 종전 동작).
ALTER TABLE public.group_challenges
    ADD COLUMN started_at timestamp(6) with time zone;

UPDATE public.group_challenges SET started_at = created_at WHERE started_at IS NULL;

ALTER TABLE public.group_challenges
    ALTER COLUMN started_at SET NOT NULL;

-- 종료 시각. null = 진행 중.
-- 기존 INACTIVE 행의 ended_at 은 null 로 남긴다 — INACTIVE 를 세팅하는 코드가 한 줄도 없었고
-- (V2 가 레거시 ENDED 를 INACTIVE 로 이관한 잔재뿐) 언제 끝났는지 복원할 근거가 없다.
-- 없는 시각을 created_at 등으로 꾸며내면 이력이 거짓이 된다(forward-only, 불일치 수용+문서화).
ALTER TABLE public.group_challenges
    ADD COLUMN ended_at timestamp(6) with time zone;

-- status 도메인은 ACTIVE/INACTIVE 를 그대로 둔다(V2 의 CHECK).
-- 정책 표기는 ACTIVE|ENDED 지만, 값 이름을 바꾸면 기존 행 이관 + CHECK 교체 + 앱이 분기하는
-- 응답 문자열까지 함께 깨진다. 여기서는 **INACTIVE 의 의미를 "종료(ENDED)"로 확정**만 하고
-- 이름 변경은 범위 밖으로 둔다(GroupChallengeStatus javadoc 에 같은 근거를 남겼다).

-- ── 3) 창 시각을 time 으로 (GROMO-1263) ───────────────────────────────
-- window_start_at/window_end_at 은 timestamptz 지만 "KST 벽시계 시각만 유효, 날짜는 무의미"라는
-- 규약으로 저장돼 있었다(GROMO-1100·1225). 타입이 규약을 표현하지 못해 UTC 로 읽는 순간 9시간
-- 어긋나는 함정이 상시 열려 있다 — 타입을 time 으로 낮춰 규약을 스키마에 새긴다.
-- USING 절이 반드시 'Asia/Seoul' 이어야 한다. 생략하면 서버 TimeZone(UTC) 로 캐스팅돼 정확히
-- 9시간 어긋난다(GROMO-1100 과 같은 함정).
ALTER TABLE public.group_challenge_windows
    ALTER COLUMN window_start_at TYPE time
        USING (window_start_at AT TIME ZONE 'Asia/Seoul')::time,
    ALTER COLUMN window_end_at TYPE time
        USING (window_end_at AT TIME ZONE 'Asia/Seoul')::time;

-- _at 접미사는 시점(Instant)을 뜻하므로 time 컬럼에는 맞지 않는다. LLD §1.1 이름으로 정렬한다.
ALTER TABLE public.group_challenge_windows RENAME COLUMN window_start_at TO window_start;
ALTER TABLE public.group_challenge_windows RENAME COLUMN window_end_at TO window_end;

-- ── 4) 참가비 상한 DB CHECK (GROMO-1264) ──────────────────────────────
-- V19 는 CHECK (stake > 0) 만 걸었고 상한 1000 은 서비스 상수(GroupBetService)로만 존재했다 —
-- 배치·수동 SQL·미래의 다른 진입점이 상한을 우회할 수 있어 DB 로 승격한다(정책 §C1).
-- plain CHECK 는 기존 행을 즉시 검증하므로 범위 밖 행을 먼저 경계값으로 클램프한다(V28 선례).
-- 삭제가 아니라 클램프인 이유: 내기 행은 코인이 오간 이력이라 지우면 정산 근거가 사라진다.
UPDATE public.group_challenge_bets SET stake = 1000 WHERE stake > 1000;
UPDATE public.group_challenge_bets SET stake = 1 WHERE stake < 1;

-- V19 가 인라인 CHECK 로 만들어 제약명이 마이그레이션에 명시돼 있지 않다(자동명
-- group_challenge_bets_stake_check). 이름에 의존하지 않도록 stake 컬럼을 참조하는 CHECK 를
-- 찾아 드롭한다 — V20:13-30 의 이름-무관 드롭 패턴 재사용.
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
                        AND a.attname = 'stake'
                        AND a.attnum = ANY (c.conkey))
    LOOP
        EXECUTE format('ALTER TABLE public.group_challenge_bets DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE public.group_challenge_bets
    ADD CONSTRAINT group_challenge_bets_stake_check
        CHECK (stake BETWEEN 1 AND 1000);

-- ── 5) members 잔재 컬럼 제거 (GROMO-1265) ────────────────────────────
-- is_achieved 는 GroupChallengeMemberRepository 의 네이티브 INSERT 가 더미 false 만 쓰고 읽는
-- 코드가 없었다(같은 커밋에서 컬럼 목록에서 제거). achieved_at·deleted_at 은 쓰기 0건.
-- 판정은 조회 시 계산이라 이 테이블은 클라 보고 원본(progress_minutes)만 담는다.
ALTER TABLE public.group_challenge_members
    DROP COLUMN is_achieved,
    DROP COLUMN achieved_at,
    DROP COLUMN deleted_at;

-- ── 6) usage_date NOT NULL (GROMO-1266) ───────────────────────────────
-- nullable 이라 UNIQUE (group_challenge_id, user_id, usage_date) 가 NULL 끼리는 안 걸린다
-- (Postgres 유니크는 NULL 을 서로 다른 값으로 본다) — 같은 (챌린지, 유저)로 무한히 행이 쌓일 수 있다.
-- NULL 행은 **삭제**한다. 백필이 아니라 삭제인 이유:
--   ① 이 테이블은 V1 이후 쓰는 코드가 없다가 V20 에서 usage_date 와 함께 재활용됐다. NULL 행은
--      전부 그 이전의 유령 행이고 progress_minutes 도 의미 없는 초기값이다.
--   ② 날짜 없는 보고는 어느 회차의 값인지 복원할 수 없어 어떤 날짜로 백필해도 거짓이 되고,
--      임의 날짜를 넣으면 그 날짜의 실제 보고와 유니크 충돌해 마이그레이션 자체가 깨진다.
--   ③ 돈이 오간 기록이 아니다(정산 근거는 group_challenge_bet_participants) — 지워도 이력 손실이 없다.
DELETE FROM public.group_challenge_members WHERE usage_date IS NULL;

ALTER TABLE public.group_challenge_members
    ALTER COLUMN usage_date SET NOT NULL;

-- ── 7) 스크린타임 미집계와 0분의 구분 (GROMO-1267) ────────────────────
-- 앱이 actualScreenTimeMinutes 없이 보고하면 ScreenTimeService 가 0 으로 저장해 실제 "0분 사용"과
-- 구분되지 않았다. 스크린타임은 0분 = 달성이라 미보고가 달성으로 뒤집히는 방향이라 위험하다
-- (정책 §B7). 저장 단계에서 null(미집계)로 구분한다 — 읽는 쪽은 null 을 미달성/미표시로 다룬다.
ALTER TABLE public.daily_screen_time_stats
    ALTER COLUMN total_screen_time_minutes DROP NOT NULL;
