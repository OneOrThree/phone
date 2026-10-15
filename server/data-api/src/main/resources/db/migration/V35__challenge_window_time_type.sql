-- ════════════════════════════════════════════════════════════════════
-- V35 — 창 시각 time 전환 + 자정 걸침 금지 (GROMO-1406 · N25 · §A6-1)
-- ════════════════════════════════════════════════════════════════════
-- 기존 timestamptz 는 "KST 벽시계 시각만 유효, 날짜부 무의미" 라는 해석 규약이었다(GROMO-1100/1225).
-- 규약을 타입으로 승격한다 — time 으로 바꾸면 저장값이 곧 의미다. 백필은 반드시
-- AT TIME ZONE 'Asia/Seoul' 로 벽시계를 추출한다(UTC 로 읽으면 정확히 9시간 어긋난다).
-- CHECK (window_start < window_end) 로 자정 걸침(회차가 요일 경계를 넘는 창)을 DB 가 금지한다.

-- ── 0) 사전 검사 — 걸침 허용 시절의 start >= end 행이 남아 있으면 여기서 멈춘다 ──
-- CHECK 추가가 어차피 실패하지만, 무엇이 몇 건 문제인지 명시적으로 말하고 죽는 쪽이 낫다.
-- prod 배포 전 확인 쿼리(LLD §1.3): SELECT count(*) FROM group_challenge_windows
--   WHERE (window_start_at AT TIME ZONE 'Asia/Seoul')::time >= (window_end_at AT TIME ZONE 'Asia/Seoul')::time
DO $$
DECLARE
    violating integer;
BEGIN
    SELECT count(*)
    INTO violating
    FROM public.group_challenge_windows
    WHERE (window_start_at AT TIME ZONE 'Asia/Seoul')::time
              >= (window_end_at AT TIME ZONE 'Asia/Seoul')::time;
    IF violating > 0 THEN
        RAISE EXCEPTION 'V35 중단 — KST 기준 시작 >= 종료(자정 걸침·0길이) 창 % 건 존재. 자정 앞에서 끊거나(예: 22:00~23:59) 해당 챌린지를 정리한 뒤 재실행할 것 (policy §A6-1)', violating;
    END IF;
END $$;

-- ── 1) 타입 전환 — KST 벽시계 추출 백필(날짜부 폐기) ─────────────────────
ALTER TABLE public.group_challenge_windows
    ALTER COLUMN window_start_at TYPE time(6)
        USING (window_start_at AT TIME ZONE 'Asia/Seoul')::time;

ALTER TABLE public.group_challenge_windows
    ALTER COLUMN window_end_at TYPE time(6)
        USING (window_end_at AT TIME ZONE 'Asia/Seoul')::time;

-- 이름도 의미에 맞춘다 — "_at" 접미사는 시점(Instant)용, 이제는 벽시계 시각이다.
ALTER TABLE public.group_challenge_windows
    RENAME COLUMN window_start_at TO window_start;

ALTER TABLE public.group_challenge_windows
    RENAME COLUMN window_end_at TO window_end;

-- ── 2) 자정 걸침 금지 CHECK ──────────────────────────────────────────
-- start < end 단일 조건 — 0길이·역전·걸침이 전부 여기서 걸린다.
ALTER TABLE public.group_challenge_windows
    ADD CONSTRAINT group_challenge_windows_start_end_check
        CHECK (window_start < window_end);
