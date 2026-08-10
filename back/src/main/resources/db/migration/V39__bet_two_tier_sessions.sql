-- ════════════════════════════════════════════════════════════════════
-- V39 — 내기 2계층 재편 + 미션 스냅샷 (GROMO-1262 · GROMO-1263)
-- ════════════════════════════════════════════════════════════════════
-- 현행 group_challenge_bets 는 행 1개 = (챌린지, 날짜)의 판이자 정산 단위였다. 이를 분해한다:
--   · group_challenge_bets          = 설정 계층 — 챌린지 1:1(UNIQUE), stake·enabled. "개설" 행위 소멸
--   · group_challenge_bet_sessions  = 회차 계층 — 챌린지가 실제 도는 하루. 참가·판정·정산의 단위
--   · group_challenge_bet_participants 의 축을 내기 행 → 회차로 이동 (UNIQUE (session_id, user_id))
-- V19/V20/V28 의 (챌린지, 날짜) (부분) 유니크로 강제되던 구 FR-7 은 폐기된다.
--
-- 데이터 이전(백필): 기존 비취소 내기 행 1개 → 설정 1행(챌린지당, 최신 행 기준) + 그 날짜의 회차
-- 1행으로 분해한다. 회차 id 는 기존 내기 행 id 를 재사용한다 — 참가 행의 bet_id 값이 그대로
-- session_id 가 되어 참조 재매핑이 필요 없다(원장 멱등키·알림 dedup 의 대상 id 도 안 흔들린다).
-- CANCELED(취소) 내기는 "없던 일"이라 회차를 만들지 않고 참가 행도 함께 정리한다(전액 환불이 이미
-- 끝난 행들이다 — 원장 currency_transactions 이 돈의 단일 진실로 남는다).
--
-- 미션 스냅샷(GROMO-1263): 회차 행에 카테고리·방식·목표분·창 시각·참가비를 박제한다 — 챌린지가
-- 삭제돼도 「그룹 챌린지 내역」한 줄이 조인 없이 온전해야 한다(N6-1). goal_minutes 는 기존 정산
-- 스냅샷(V29) → CTI 상세 순으로 채우되, 어느 쪽에도 없는 과거 이력은 null 로 남긴다(앱 "—" 표시)
-- — 그래서 LLD ERD 와 달리 NOT NULL 을 걸지 않는다.
--
-- 창 시각 추출: 이 마이그레이션은 group_challenge_windows 의 신·구 스키마를 모두 수용한다 —
-- 구(window_start_at timestamptz, KST 벽시계 규약)면 (AT TIME ZONE 'Asia/Seoul')::time 으로
-- 추출하고(GROMO-1100 함정 — UTC 로 읽으면 9시간 어긋난다), 신(window_start time, 선행 배치 B1 의
-- 전환 이후)이면 그대로 복사한다.

-- ── 0) 창 스키마 정규화 (신·구 겸용 임시 테이블) ─────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'group_challenge_windows'
                 AND column_name = 'window_start_at') THEN
        EXECUTE 'CREATE TEMP TABLE v39_windows AS
                 SELECT challenge_id,
                        (window_start_at AT TIME ZONE ''Asia/Seoul'')::time AS window_start,
                        (window_end_at   AT TIME ZONE ''Asia/Seoul'')::time AS window_end,
                        duration_minutes
                 FROM public.group_challenge_windows';
    ELSE
        EXECUTE 'CREATE TEMP TABLE v39_windows AS
                 SELECT challenge_id, window_start, window_end, duration_minutes
                 FROM public.group_challenge_windows';
    END IF;
END $$;

-- ── 1) 설정 생존자 선정 — 챌린지당 최신 비취소 내기 1행 ────────────────────
-- 설정 stake 는 마지막으로 열린 판의 값을 승계한다(동률이면 id 큰 쪽 = UUID v7 시간순).
-- 취소 이력뿐인 챌린지는 설정을 만들지 않는다("없던 일" — 재개설 시 새로 생긴다).
CREATE TEMP TABLE v39_bet_config_map AS
SELECT DISTINCT ON (b.challenge_id)
       gen_random_uuid() AS config_id,
       b.challenge_id,
       b.group_id,
       b.creator_user_id,
       b.stake,
       b.created_at
FROM public.group_challenge_bets b
WHERE b.status <> 'CANCELED'
ORDER BY b.challenge_id, b.created_at DESC, b.id DESC;

-- ── 2) 회차 테이블 신설 ───────────────────────────────────────────────
-- bet_id FK 는 설정 행 삽입(6단계) 뒤에 건다. stake CHECK 는 V19 와 같은 하한만 — 1~3000 범위는
-- V40 이 설정·회차 양쪽에 함께 강제한다(GROMO-1264).
CREATE TABLE public.group_challenge_bet_sessions (
    id uuid PRIMARY KEY,
    bet_id uuid NOT NULL,
    -- 내역이 그룹 소유라(챌린지 삭제 후에도 조회) 비정규화해 둔다.
    group_id uuid NOT NULL REFERENCES public.groups(id),
    -- 챌린지는 소프트 삭제라 행이 남는다 — 삭제 뒤에도 값은 유효하다.
    challenge_id uuid NOT NULL REFERENCES public.group_challenges(id),
    session_date date NOT NULL,
    stake integer NOT NULL
        CONSTRAINT group_challenge_bet_sessions_stake_check CHECK (stake > 0),
    goal_minutes integer
        CONSTRAINT group_challenge_bet_sessions_goal_minutes_check
            CHECK (goal_minutes IS NULL OR goal_minutes > 0),
    mission_category character varying(20) NOT NULL
        CONSTRAINT group_challenge_bet_sessions_mission_category_check
            CHECK ((mission_category)::text = ANY ((ARRAY[
                'FOCUS'::character varying,
                'SCREEN_TIME'::character varying])::text[])),
    mission_type character varying(20) NOT NULL
        CONSTRAINT group_challenge_bet_sessions_mission_type_check
            CHECK ((mission_type)::text = ANY ((ARRAY[
                'DURATION'::character varying,
                'TIME_WINDOW'::character varying])::text[])),
    window_start time,
    window_end time,
    status character varying(20) NOT NULL
        CONSTRAINT group_challenge_bet_sessions_status_check
            CHECK ((status)::text = ANY ((ARRAY[
                'OPEN'::character varying,
                'SETTLED'::character varying,
                'REFUNDED'::character varying,
                'FORFEITED'::character varying,
                'VOIDED'::character varying])::text[])),
    starts_at timestamp(6) with time zone NOT NULL,
    join_closes_at timestamp(6) with time zone NOT NULL,
    closes_at timestamp(6) with time zone NOT NULL,
    settle_after timestamp(6) with time zone NOT NULL,
    settled_at timestamp(6) with time zone,
    settle_attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    -- 회차 중복 개설 방어 — 하루 1회차. 구 부분 유니크(WHERE status <> 'CANCELED')는 취소 상태의
    -- 소멸과 함께 전체 유니크로 단순해졌다(취소된 유저 개설 회차는 행 삭제 = "없던 일").
    CONSTRAINT uq_group_challenge_bet_sessions_bet_date UNIQUE (bet_id, session_date)
);

-- ── 3) 회차 백필 — 비취소 내기 행 → 그 날짜의 회차 1행 (id 재사용) ─────────
-- 시각 박제: 하루형은 회차일 00:00 ~ 익일 00:00 (KST), 창형은 창 시작 ~ 창 종료(구 자정 걸침
-- 창은 익일 종료). join_closes_at 은 LLD §1.1 정의(창형 = 창 시작, 하루형 = 회차 종료)로,
-- settle_after 는 창형 +30분(N12) · 하루형 FOCUS +1h · SCREEN_TIME +12h(기존 배치 시각과 짝)로
-- 계산한다. 이미 정산된 이력 행의 시각은 표시·감사용 재구성값이다(정산 결과는 불변).
INSERT INTO public.group_challenge_bet_sessions
    (id, bet_id, group_id, challenge_id, session_date, stake, goal_minutes,
     mission_category, mission_type, window_start, window_end, status,
     starts_at, join_closes_at, closes_at, settle_after, settled_at,
     settle_attempts, next_attempt_at, created_at, updated_at)
SELECT b.id,
       m.config_id,
       b.group_id,
       b.challenge_id,
       b.bet_date,
       b.stake,
       COALESCE(b.goal_minutes, d.duration_minutes, vw.duration_minutes),
       c.category,
       c.type,
       CASE WHEN c.type = 'TIME_WINDOW' THEN vw.window_start END,
       CASE WHEN c.type = 'TIME_WINDOW' THEN vw.window_end END,
       b.status,
       t.starts_at,
       CASE WHEN c.type = 'TIME_WINDOW' THEN t.starts_at ELSE t.closes_at END,
       t.closes_at,
       t.closes_at + CASE
           WHEN c.type = 'TIME_WINDOW' THEN interval '30 minutes'
           WHEN c.category = 'SCREEN_TIME' THEN interval '12 hours'
           ELSE interval '1 hour'
       END,
       b.settled_at,
       0,
       NULL,
       b.created_at,
       b.updated_at
FROM public.group_challenge_bets b
JOIN v39_bet_config_map m ON m.challenge_id = b.challenge_id
JOIN public.group_challenges c ON c.id = b.challenge_id
LEFT JOIN public.group_challenge_durations d ON d.challenge_id = b.challenge_id
LEFT JOIN v39_windows vw ON vw.challenge_id = b.challenge_id
CROSS JOIN LATERAL (
    SELECT CASE WHEN c.type = 'TIME_WINDOW'
                THEN (b.bet_date + vw.window_start) AT TIME ZONE 'Asia/Seoul'
                ELSE (b.bet_date::timestamp) AT TIME ZONE 'Asia/Seoul' END AS starts_at,
           CASE WHEN c.type = 'TIME_WINDOW'
                THEN ((CASE WHEN vw.window_start < vw.window_end
                            THEN b.bet_date ELSE b.bet_date + 1 END)
                      + vw.window_end) AT TIME ZONE 'Asia/Seoul'
                ELSE ((b.bet_date + 1)::timestamp) AT TIME ZONE 'Asia/Seoul' END AS closes_at
) t
WHERE b.status <> 'CANCELED';

-- ── 4) 취소 내기의 참가 행 정리 — "없던 일" ──────────────────────────────
-- CANCELED 내기는 회차가 없으므로 참가 행이 갈 곳이 없다. 취소 시점에 전액 환불이 끝난 행들이라
-- (환불 멱등 기록은 원장에 남아 있다) 이력 손실이 아니다.
DELETE FROM public.group_challenge_bet_participants p
USING public.group_challenge_bets b
WHERE p.bet_id = b.id AND b.status = 'CANCELED';

-- ── 5) 참가 축 이동 — bet_id → session_id ──────────────────────────────
-- 회차 id = 구 내기 행 id 라 값 자체는 그대로다. FK 만 회차 테이블로 갈아 끼운다.
-- V19 는 참가 FK 를 인라인으로 만들어 이름이 마이그레이션에 명시돼 있지 않다 — 이름-무관으로
-- 드롭한다(V20 관행).
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.group_challenge_bet_participants'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'public.group_challenge_bets'::regclass
    LOOP
        EXECUTE format('ALTER TABLE public.group_challenge_bet_participants DROP CONSTRAINT %I',
                       con.conname);
    END LOOP;
END $$;

ALTER TABLE public.group_challenge_bet_participants RENAME COLUMN bet_id TO session_id;
ALTER TABLE public.group_challenge_bet_participants
    DROP CONSTRAINT uq_group_challenge_bet_participants_bet_user;
ALTER TABLE public.group_challenge_bet_participants
    ADD CONSTRAINT uq_group_challenge_bet_participants_session_user UNIQUE (session_id, user_id);
ALTER TABLE public.group_challenge_bet_participants
    ADD CONSTRAINT fk_group_challenge_bet_participants_session
        FOREIGN KEY (session_id) REFERENCES public.group_challenge_bet_sessions(id);

-- ── 6) 설정 행 삽입 → 구 내기 행 삭제 → 설정 스키마로 축소 ─────────────────
-- 곧 드롭할 NOT NULL 컬럼(bet_date·status·creator_user_id)은 자리만 채운다.
INSERT INTO public.group_challenge_bets
    (id, group_id, challenge_id, creator_user_id, stake, bet_date, status, created_at, updated_at)
SELECT m.config_id, m.group_id, m.challenge_id, m.creator_user_id, m.stake,
       DATE '1970-01-01', 'OPEN', m.created_at, now()
FROM v39_bet_config_map m;

DELETE FROM public.group_challenge_bets b
WHERE b.id NOT IN (SELECT config_id FROM v39_bet_config_map);

-- 판(날짜·상태·정산) 컬럼 제거 — 종속 인덱스(V28 부분 유니크·V19 status_bet_date)도 함께 떨어진다.
ALTER TABLE public.group_challenge_bets
    DROP COLUMN creator_user_id,
    DROP COLUMN bet_date,
    DROP COLUMN status,
    DROP COLUMN settled_at,
    DROP COLUMN goal_minutes;

-- V28 의 휴면 배지 조회용 일반 인덱스 — 아래 챌린지 UNIQUE 가 대체한다.
DROP INDEX IF EXISTS public.idx_group_challenge_bets_challenge_id;

-- 내기 켜짐 여부 — 생성 시 결정, 이후 불변(끄려면 챌린지 삭제 후 재생성 — policy §A7·N26).
-- 기존 설정(내기가 걸려 있던 챌린지)은 전부 켜짐이다.
ALTER TABLE public.group_challenge_bets
    ADD COLUMN enabled boolean NOT NULL DEFAULT true;

-- 챌린지당 설정 1개 — 2계층의 뼈대.
ALTER TABLE public.group_challenge_bets
    ADD CONSTRAINT uq_group_challenge_bets_challenge UNIQUE (challenge_id);

-- ── 7) 회차 → 설정 FK + 조회 인덱스 ───────────────────────────────────
ALTER TABLE public.group_challenge_bet_sessions
    ADD CONSTRAINT fk_group_challenge_bet_sessions_bet
        FOREIGN KEY (bet_id) REFERENCES public.group_challenge_bets(id);

-- 정산 대상 스캔(상태·정산 가능 시각·백오프 — B4 크론이 탄다).
CREATE INDEX idx_group_challenge_bet_sessions_settle_scan
    ON public.group_challenge_bet_sessions (status, settle_after, next_attempt_at);

-- 카드 조립(그룹 단위 내역·오늘 회차).
CREATE INDEX idx_group_challenge_bet_sessions_group_date
    ON public.group_challenge_bet_sessions (group_id, session_date);

-- 챌린지 스코프 조회(히스토리·삭제 가드·휴면 배지).
CREATE INDEX idx_group_challenge_bet_sessions_challenge_id
    ON public.group_challenge_bet_sessions (challenge_id);

DROP TABLE v39_bet_config_map;
DROP TABLE v39_windows;
